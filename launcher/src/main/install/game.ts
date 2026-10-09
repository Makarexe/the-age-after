import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MinecraftFolder, Version } from '@xmcl/core';
import {
  fetchJavaRuntimeManifest,
  getVersionList,
  installNeoForgedTask,
  installJavaRuntimeTask,
  installTask,
} from '@xmcl/installer';
import type { Task } from '@xmcl/task';
import { MINECRAFT_VERSION, NEOFORGE_VERSION } from '../../shared/constants';
import { UserError } from '../errors';
import { log } from '../log';

export type StepProgress = (fraction: number | null, detail?: string) => void;

const MARKERS_DIR = '.launcher-markers';

/** Markers let later launches skip re-verifying thousands of files; "repair" deletes them. */
async function hasMarker(gameDir: string, name: string, value: string): Promise<boolean> {
  try {
    return (await readFile(path.join(gameDir, MARKERS_DIR, name), 'utf8')) === value;
  } catch {
    return false;
  }
}

async function setMarker(gameDir: string, name: string, value: string): Promise<void> {
  await mkdir(path.join(gameDir, MARKERS_DIR), { recursive: true });
  await writeFile(path.join(gameDir, MARKERS_DIR, name), value);
}

export async function clearMarkers(gameDir: string): Promise<void> {
  await rm(path.join(gameDir, MARKERS_DIR), { recursive: true, force: true });
}

async function runTask<T>(task: Task<T>, onProgress: StepProgress): Promise<T> {
  let last = 0;
  return task.startAndWait({
    onUpdate() {
      const now = Date.now();
      if (now - last < 100) return;
      last = now;
      onProgress(task.total > 0 ? task.progress / task.total : null);
    },
  });
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') return JSON.stringify(err).slice(0, 300);
  return String(err);
}

/** Vanilla 1.21.1: version json, client jar, libraries, assets. Returns the Java component it needs. */
export async function ensureMinecraft(gameDir: string, onProgress: StepProgress): Promise<{ javaComponent: string; javaMajor: number }> {
  const folder = MinecraftFolder.from(gameDir);
  const marker = MINECRAFT_VERSION;
  if (!(await hasMarker(gameDir, 'minecraft', marker)) || !existsSync(folder.getVersionJson(MINECRAFT_VERSION))) {
    onProgress(null, 'Список версий');
    let list;
    try {
      list = await getVersionList();
    } catch (err) {
      throw new UserError(`Не удалось получить список версий Minecraft: ${describe(err)}`);
    }
    const meta = list.versions.find((v) => v.id === MINECRAFT_VERSION);
    if (!meta) throw new UserError(`Версия Minecraft ${MINECRAFT_VERSION} не найдена.`);
    try {
      await runTask(installTask(meta, folder), onProgress);
    } catch (err) {
      log.error('minecraft install failed', err);
      throw new UserError(`Не удалось установить Minecraft ${MINECRAFT_VERSION}: ${describe(err)}`);
    }
    await setMarker(gameDir, 'minecraft', marker);
  }
  const resolved = await Version.parse(folder, MINECRAFT_VERSION);
  return {
    javaComponent: resolved.javaVersion?.component ?? 'java-runtime-delta',
    javaMajor: resolved.javaVersion?.majorVersion ?? 21,
  };
}

export interface JavaPaths {
  /** java.exe: used to run the NeoForge installer processors */
  java: string;
  /** javaw.exe: runs the game without a console window */
  javaw: string;
}

export function javaPaths(gameDir: string, component: string): JavaPaths {
  const home = path.join(gameDir, 'runtime', component);
  const win = process.platform === 'win32';
  return {
    java: path.join(home, 'bin', win ? 'java.exe' : 'java'),
    javaw: path.join(home, 'bin', win ? 'javaw.exe' : 'java'),
  };
}

/** Java from Mojang's java-runtime (the same one the official launcher uses). */
export async function ensureJava(gameDir: string, component: string, onProgress: StepProgress): Promise<JavaPaths> {
  const paths = javaPaths(gameDir, component);
  if ((await hasMarker(gameDir, `java-${component}`, 'ok')) && existsSync(paths.javaw)) return paths;
  onProgress(null, 'Список файлов Java');
  try {
    const manifest = await fetchJavaRuntimeManifest({ target: component });
    await runTask(installJavaRuntimeTask({ destination: path.dirname(path.dirname(paths.java)), manifest }), onProgress);
  } catch (err) {
    log.error('java install failed', err);
    throw new UserError(`Не удалось установить Java: ${describe(err)}`);
  }
  if (!existsSync(paths.java)) throw new UserError('Java установилась не полностью. Нажмите «Проверить файлы» в настройках.');
  await setMarker(gameDir, `java-${component}`, 'ok');
  return paths;
}

export async function ensureNeoForge(gameDir: string, java: string, onProgress: StepProgress): Promise<string> {
  const folder = MinecraftFolder.from(gameDir);
  // The marker stores the version id the installer produced.
  const installedId = await readFile(path.join(gameDir, MARKERS_DIR, 'neoforge'), 'utf8').catch(() => '');
  const [markerVersion, markerId] = installedId.split('|');
  if (markerVersion === NEOFORGE_VERSION && markerId && existsSync(folder.getVersionJson(markerId))) return markerId;
  let id: string;
  try {
    id = await runTask(installNeoForgedTask('neoforge', NEOFORGE_VERSION, folder, { java, side: 'client' }), onProgress);
  } catch (err) {
    log.error('neoforge install failed', err);
    throw new UserError(`Не удалось установить NeoForge ${NEOFORGE_VERSION}: ${describe(err)}`);
  }
  await setMarker(gameDir, 'neoforge', `${NEOFORGE_VERSION}|${id}`);
  return id;
}
