import { existsSync } from 'node:fs';
import { chmod, lstat, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MinecraftFolder, Version } from '@xmcl/core';
import {
  getVersionList,
  installNeoForgedTask,
  installJavaRuntimeTask,
  installTask,
} from '@xmcl/installer';
import type { Task } from '@xmcl/task';
import { MINECRAFT_VERSION, NEOFORGE_VERSION } from '../../shared/constants';
import { UserError } from '../errors';
import { log } from '../log';
import { downloadFile } from './download';
import { fetchJavaManifest } from './java-manifest';
import { extractOverrides } from './pack';
import { withRetries } from './retry';
import { assetHosts, BMCLAPI, describeError, downloadAgent, libraryUrls } from './net';

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

/** The same step again after a network hiccup; the player sees "пробуем ещё раз". */
function retrying<T>(what: string, fn: () => Promise<T>, onProgress: StepProgress): Promise<T> {
  return withRetries(fn, {
    onRetry: (attempt, attempts, err) => {
      log.warn(`${what} failed, attempt ${attempt}/${attempts}`, err);
      onProgress(null, `Не получилось, пробуем ещё раз (${attempt}/${attempts})…`);
    },
  });
}


/** Vanilla 1.21.1: version json, client jar, libraries, assets. Returns the Java component it needs. */
export async function ensureMinecraft(gameDir: string, onProgress: StepProgress): Promise<{ javaComponent: string; javaMajor: number }> {
  const folder = MinecraftFolder.from(gameDir);
  const marker = MINECRAFT_VERSION;
  if (!(await hasMarker(gameDir, 'minecraft', marker)) || !existsSync(folder.getVersionJson(MINECRAFT_VERSION))) {
    onProgress(null, 'Список версий');
    let list;
    try {
      list = await retrying('version list', () => getVersionList(), onProgress);
    } catch (err) {
      throw new UserError(`Не удалось получить список версий Minecraft: ${describeError(err)}`);
    }
    const meta = list.versions.find((v) => v.id === MINECRAFT_VERSION);
    if (!meta) throw new UserError(`Версия Minecraft ${MINECRAFT_VERSION} не найдена.`);
    try {
      await retrying('minecraft install', () =>
          runTask(
            installTask(meta, folder, { dispatcher: downloadAgent(), assetsHost: assetHosts, libraryHost: libraryUrls }),
            onProgress,
          ), onProgress);
    } catch (err) {
      log.error('minecraft install failed', err);
      throw new UserError(`Не удалось установить Minecraft ${MINECRAFT_VERSION}: ${describeError(err)}`);
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

export function javaPaths(gameDir: string, component: string, platform: NodeJS.Platform = process.platform): JavaPaths & { root: string } {
  const root = path.join(gameDir, 'runtime', component);
  // Mojang's macOS runtime is a bundle: the files start at jre.bundle/Contents/Home.
  const home = platform === 'darwin' ? path.join(root, 'jre.bundle', 'Contents', 'Home') : root;
  const win = platform === 'win32';
  return {
    root,
    java: path.join(home, 'bin', win ? 'java.exe' : 'java'),
    javaw: path.join(home, 'bin', win ? 'javaw.exe' : 'java'),
  };
}

/**
 * @xmcl/installer downloads the runtime files but sets no permissions and fakes symlinks with hard links,
 * so on macOS/Linux `bin/java` isn't executable. Fixed here from the same manifest.
 */
export async function applyJavaFileModes(
  destination: string,
  files: Record<string, { type: string; executable?: boolean; target?: string }>,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform === 'win32') return;
  for (const [file, entry] of Object.entries(files)) {
    const dest = path.join(destination, ...file.split('/'));
    if (entry.type === 'file' && entry.executable) await chmod(dest, 0o755);
    else if (entry.type === 'link' && entry.target) {
      if ((await lstat(dest).catch(() => null))?.isSymbolicLink()) continue;
      await rm(dest, { force: true });
      await symlink(entry.target, dest);
    }
  }
}

/** Java from Mojang's java-runtime (the same one the official launcher uses). */
export async function ensureJava(gameDir: string, component: string, onProgress: StepProgress): Promise<JavaPaths> {
  const paths = javaPaths(gameDir, component);
  if ((await hasMarker(gameDir, `java-${component}`, 'ok')) && existsSync(paths.javaw)) return paths;
  onProgress(null, 'Список файлов Java');
  try {
    const manifest = await retrying('java manifest', () => fetchJavaManifest(component), onProgress);
    const destination = paths.root;
    await retrying('java install', () => runTask(installJavaRuntimeTask({ destination, manifest, dispatcher: downloadAgent() }), onProgress), onProgress);
    await applyJavaFileModes(destination, manifest.files as Parameters<typeof applyJavaFileModes>[1]);
  } catch (err) {
    log.error('java install failed', err);
    throw new UserError(`Не удалось установить Java: ${describeError(err)}`);
  }
  if (!existsSync(paths.java)) throw new UserError('Java установилась не полностью. Нажмите «Проверить файлы» в настройках.');
  await setMarker(gameDir, `java-${component}`, 'ok');
  return paths;
}

/**
 * The libraries NeoForge's installer takes from maven.neoforged.net come as one zip from our release (some players
 * can't reach that host). Unpacked into libraries/ before the install, which then finds valid files and skips them.
 * Any failure is only logged: the normal download (official maven, then the mirror) still follows.
 */
export async function ensureNeoForgeLibraries(
  gameDir: string,
  libs: { url: string; sha1: string },
  onProgress: StepProgress,
  fetchImpl?: typeof fetch,
): Promise<void> {
  if (await hasMarker(gameDir, 'neoforge-libraries', libs.sha1)) return;
  const tmp = path.join(gameDir, '.launcher-tmp', 'neoforge-libraries.zip');
  try {
    onProgress(null, 'Библиотеки NeoForge (наш сервер)');
    await downloadFile({ url: libs.url, dest: tmp, hash: { algorithm: 'sha1', value: libs.sha1 }, fetchImpl, onBytes: () => onProgress(null) });
    await extractOverrides(tmp, gameDir, []);
    await setMarker(gameDir, 'neoforge-libraries', libs.sha1);
  } catch (err) {
    log.warn('neoforge libraries archive failed, falling back to maven', err);
  } finally {
    await rm(path.dirname(tmp), { recursive: true, force: true });
  }
}

/** Added to the install error when the hosts look blocked or return broken files. */
export function neoForgeNetworkHint(message: string): string {
  return /ETIMEDOUT|ECONNRESET|ENOTFOUND|ECONNREFUSED|checksum|sha1/i.test(message)
    ? '\n\nПохоже, нет доступа к серверам NeoForge (maven.neoforged.net). Включите VPN на время установки и нажмите «Играть» ещё раз: после установки он не нужен.'
    : '';
}

/** `version`: the pack's NeoForge (manifest.neoforge), so a NeoForge update needs no launcher release. */
export async function ensureNeoForge(
  gameDir: string,
  java: string,
  onProgress: StepProgress,
  version: string = NEOFORGE_VERSION,
  installer?: { url: string; sha1: string },
  libraries?: { url: string; sha1: string },
): Promise<string> {
  const folder = MinecraftFolder.from(gameDir);
  // The marker stores the version id the installer produced.
  const installedId = await readFile(path.join(gameDir, MARKERS_DIR, 'neoforge'), 'utf8').catch(() => '');
  const [markerVersion, markerId] = installedId.split('|');
  if (markerVersion === version && markerId && existsSync(folder.getVersionJson(markerId))) return markerId;
  if (libraries) await ensureNeoForgeLibraries(gameDir, libraries, onProgress);
  if (installer) {
    // The installer jar is the one file xmcl can't re-verify; get it ourselves (our copy first, then the
    // official maven and the mirror, all checked against the same sha1). xmcl then finds a valid file and skips it.
    const rel = `net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`;
    await downloadFile({
      url: [installer.url, `https://maven.neoforged.net/releases/${rel}`, `${BMCLAPI}/maven/${rel}`],
      dest: folder.getLibraryByPath(rel),
      hash: { algorithm: 'sha1', value: installer.sha1 },
    }).catch((err) => log.warn('neoforge installer pre-download failed, xmcl will try', err));
  }
  let id: string;
  try {
    id = await retrying(
      'neoforge install',
      () => runTask(installNeoForgedTask('neoforge', version, folder, {
            java,
            side: 'client',
            dispatcher: downloadAgent(),
            libraryHost: libraryUrls,
          }), onProgress),
      onProgress,
    );
  } catch (err) {
    log.error('neoforge install failed', err);
    const reason = describeError(err);
    throw new UserError(`Не удалось установить NeoForge ${version}: ${reason}${neoForgeNetworkHint(reason)}`);
  }
  await setMarker(gameDir, 'neoforge', `${version}|${id}`);
  return id;
}
