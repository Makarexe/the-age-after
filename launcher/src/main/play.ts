import type { ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createMinecraftProcessWatcher, launch } from '@xmcl/core';
import type { GameState, Progress, ProgressStage, ServerConfig, Settings } from '../shared/types';
import type { ApiClient } from './api';
import { sessionExpired, UserError } from './errors';
import { ensureAuthlibInjector } from './install/authlib';
import { ensureJava, ensureMinecraft, ensureNeoForge } from './install/game';
import { fetchManifest, syncPack } from './install/pack';
import { log } from './log';
import { ensureServerListed } from './servers-dat';
import type { SessionStore } from './session';

// G1 settings from the vanilla launcher, without -Xmx (that comes from the memory setting).
const JVM_ARGS = [
  '-XX:+UnlockExperimentalVMOptions',
  '-XX:+UseG1GC',
  '-XX:G1NewSizePercent=20',
  '-XX:G1ReservePercent=20',
  '-XX:MaxGCPauseMillis=50',
  '-XX:G1HeapRegionSize=32M',
  '-Dfile.encoding=UTF-8',
];

export interface PlayDeps {
  settings: Settings;
  api: ApiClient;
  apiRoot: string;
  session: SessionStore;
  forceOverrides: boolean;
  emitProgress: (p: Progress) => void;
  emitGameState: (s: GameState) => void;
  onWindowReady: () => void;
  onExit: () => void;
}

let busy = false;
let game: ChildProcess | null = null;

export const isGameRunning = () => game !== null;

function progressReporter(emit: (p: Progress) => void) {
  let last = 0;
  return (stage: ProgressStage, label: string) =>
    (fraction: number | null, detail?: string) => {
      const now = Date.now();
      if (fraction !== null && fraction < 1 && now - last < 80) return;
      last = now;
      emit({ stage, label, fraction, detail });
    };
}

export async function play(deps: PlayDeps): Promise<void> {
  if (busy || game) throw new UserError('Игра уже запускается или запущена.');
  busy = true;
  deps.emitGameState({ state: 'preparing' });
  try {
    await prepareAndLaunch(deps);
  } catch (err) {
    deps.emitGameState({ state: 'error', message: err instanceof Error ? err.message : String(err) });
    throw err;
  } finally {
    busy = false;
  }
}

async function prepareAndLaunch(deps: PlayDeps): Promise<void> {
  const { settings, api, session } = deps;
  const gameDir = settings.gameDir;
  const step = progressReporter(deps.emitProgress);

  step('prepare', 'Проверяем вход')(null);
  const token = session.accessToken;
  const profile = session.profile;
  if (!token || !profile) throw sessionExpired();
  const refreshed = await api.refresh(token, session.clientToken);
  if (!refreshed) {
    session.clear();
    throw sessionExpired();
  }
  session.set(refreshed.accessToken, refreshed.selectedProfile ?? profile);

  step('prepare', 'Получаем настройки сервера')(null);
  const config: ServerConfig = await api.config();
  const manifest = await fetchManifest(config.packManifestUrl);
  await mkdir(gameDir, { recursive: true });

  const { javaComponent } = await ensureMinecraft(gameDir, step('minecraft', 'Устанавливаем Minecraft'));
  const java = await ensureJava(gameDir, javaComponent, step('java', 'Устанавливаем Java'));
  const versionId = await ensureNeoForge(gameDir, java.java, step('neoforge', 'Устанавливаем NeoForge'));

  step('authlib', 'Проверяем authlib-injector')(null);
  const authlibJar = await ensureAuthlibInjector(gameDir);

  const syncStep = {
    check: step('mods', 'Проверяем моды'),
    download: step('mods', 'Скачиваем моды'),
    config: step('config', 'Обновляем настройки сборки'),
  };
  const result = await syncPack({
    gameDir,
    manifest,
    forceOverrides: deps.forceOverrides,
    onProgress: (s, fraction, detail) => syncStep[s](fraction, detail),
  });
  log.info(
    `pack ${manifest.packVersion}: downloaded ${result.downloaded.length}, removed ${result.removed.length}, configs ${result.overridesApplied}`,
  );

  if (config.serverAddress) {
    // Our server first in "Multiplayer", next to whatever the player added themselves.
    await ensureServerListed(gameDir, config.serverName, config.serverAddress).catch((err) =>
      log.warn('could not update servers.dat', err),
    );
  }

  step('launch', 'Запускаем игру')(null);
  const prefetched = await api.metadataBase64();
  const proc = await launch({
    gamePath: gameDir,
    javaPath: java.javaw,
    version: versionId,
    gameProfile: { name: session.profile!.name, id: session.profile!.id },
    accessToken: session.accessToken!,
    userType: 'mojang',
    launcherName: 'TheAgeAfter',
    launcherBrand: 'The Age After',
    maxMemory: settings.memoryMb,
    minMemory: Math.min(2048, settings.memoryMb),
    extraJVMArgs: JVM_ARGS,
    yggdrasilAgent: { jar: authlibJar, server: deps.apiRoot, prefetched },
    quickPlayMultiplayer: config.serverAddress || undefined,
  });
  game = proc;
  deps.emitGameState({ state: 'running' });
  log.info(`game started, pid ${proc.pid}`);

  const tail: string[] = [];
  const keep = (data: Buffer) => {
    for (const line of data.toString('utf8').split(/\r?\n/)) {
      if (!line) continue;
      tail.push(line);
      if (tail.length > 60) tail.shift();
    }
  };
  proc.stdout?.on('data', keep);
  proc.stderr?.on('data', keep);

  createMinecraftProcessWatcher(proc)
    .on('minecraft-window-ready', () => deps.onWindowReady())
    .on('error', (err) => {
      game = null;
      log.error('game failed to start', err);
      deps.emitGameState({ state: 'error', message: `Игра не запустилась: ${err?.message ?? err}` });
      deps.onExit();
    })
    .on('minecraft-exit', ({ code, crashReport }) => {
      game = null;
      const crashed = code !== 0 && code !== null;
      log.info(`game exited with code ${code}`);
      if (crashed) log.warn('last game output:\n' + tail.join('\n'));
      deps.emitGameState({
        state: 'exited',
        code,
        crashed,
        crashReport: crashed ? (crashReport || tail.slice(-25).join('\n')) : undefined,
      });
      deps.onExit();
    });
}
