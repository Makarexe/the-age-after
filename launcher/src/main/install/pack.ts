import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { open, readEntry, walkEntriesGenerator } from '@xmcl/unzip';
import { UserError } from '../errors';
import { downloadFile, hashFile, runPool, type Fetch } from './download';

export interface PackFile {
  path: string;
  sha1: string;
  size: number;
  url: string;
}

/** A client-only mod the player can switch on; its files live in mods/ only while it is enabled. */
export interface OptionalMod {
  id: string;
  name: string;
  description: string;
  /** Dependency of another optional mod: not shown to the player, installed with it. */
  library?: boolean;
  requires?: string[];
  files: PackFile[];
}

export interface PackManifest {
  formatVersion: number;
  packVersion: string;
  minecraft: string;
  neoforge: string;
  files: PackFile[];
  /** `only`: globs; an existing install gets just these files from config.zip, a fresh one gets everything. */
  overrides: { url: string; sha1: string; size: number; only?: string[] } | null;
  managedDirs: string[];
  firstInstallOnly: string[];
  optionalMods: OptionalMod[];
}

/** CurseForge serves the same files from both hosts; when one answers 404, the other often has the file. */
const CURSEFORGE_HOSTS = ['edge.forgecdn.net', 'mediafilez.forgecdn.net'];

/** The manifest URL first, then the same CurseForge file on its other CDN host. */
export function fileUrls(url: string): string[] {
  const m = url.match(/^https:\/\/(edge|mediafilez|media)\.forgecdn\.net(\/.*)$/);
  if (!m) return [url];
  return [url, ...CURSEFORGE_HOSTS.filter((h) => !url.startsWith(`https://${h}/`)).map((h) => `https://${h}${m[2]}`)];
}

interface CachedFile {
  size: number;
  mtimeMs: number;
  sha1: string;
}

export interface PackState {
  packVersion?: string;
  overridesSha1?: string;
  files: Record<string, CachedFile>;
}

export const STATE_FILE = 'launcher-pack.json';
const CONCURRENCY = 8;

/** Relative, forward slashes, no `..`, no drive letters: a manifest can't write outside the game folder. */
export function isSafeRelativePath(p: string): boolean {
  if (!p || p.startsWith('/') || p.includes('\\') || /^[A-Za-z]:/.test(p)) return false;
  return p.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

export function validateManifest(data: unknown): PackManifest {
  const m = data as PackManifest;
  if (!m || m.formatVersion !== 1 || !Array.isArray(m.files) || typeof m.packVersion !== 'string') {
    throw new UserError('Манифест сборки повреждён или слишком новый — обновите лаунчер.');
  }
  // Goes into the NeoForge installer and file names.
  if (typeof m.neoforge !== 'string' || !/^\d+(\.\d+)+(-[A-Za-z0-9.]+)?$/.test(m.neoforge)) {
    throw new UserError(`В манифесте сборки неверная версия NeoForge: ${String(m.neoforge)}`);
  }
  for (const f of m.files) {
    if (!isSafeRelativePath(f.path) || !/^[0-9a-f]{40}$/i.test(f.sha1) || !/^https:\/\//.test(f.url)) {
      throw new UserError(`Манифест сборки содержит неверную запись: ${String(f.path)}`);
    }
  }
  for (const d of [...(m.managedDirs ?? []), ...(m.firstInstallOnly ?? [])]) {
    if (!isSafeRelativePath(d)) throw new UserError(`Манифест сборки содержит неверный путь: ${d}`);
  }
  if (m.overrides?.only !== undefined && (!Array.isArray(m.overrides.only) || m.overrides.only.some((g) => typeof g !== 'string' || !g))) {
    throw new UserError('Манифест сборки содержит неверный список конфигов.');
  }
  // Absent in manifests published before optional mods existed.
  const optionalMods = m.optionalMods ?? [];
  const ids = new Set<string>();
  for (const o of optionalMods) {
    if (!o || typeof o.id !== 'string' || typeof o.name !== 'string' || !Array.isArray(o.files) || ids.has(o.id)) {
      throw new UserError('Манифест сборки содержит неверный опциональный мод.');
    }
    ids.add(o.id);
    for (const f of o.files) {
      if (!isSafeRelativePath(f.path) || !/^[0-9a-f]{40}$/i.test(f.sha1) || !/^https:\/\//.test(f.url)) {
        throw new UserError(`Манифест сборки содержит неверную запись: ${String(f.path)}`);
      }
    }
  }
  for (const o of optionalMods) {
    for (const r of o.requires ?? []) {
      if (!ids.has(r)) throw new UserError(`Опциональный мод ${o.id} требует неизвестный ${r}.`);
    }
  }
  return { ...m, managedDirs: m.managedDirs ?? [], firstInstallOnly: m.firstInstallOnly ?? [], optionalMods };
}

/** Files of the enabled optional mods plus everything they require; unknown ids are ignored. */
export function optionalFiles(manifest: PackManifest, enabled: string[]): PackFile[] {
  const byId = new Map(manifest.optionalMods.map((o) => [o.id, o]));
  const taken = new Set<string>();
  const visit = (id: string) => {
    const o = byId.get(id);
    if (!o || taken.has(id)) return;
    taken.add(id);
    o.requires?.forEach(visit);
  };
  enabled.forEach(visit);
  const own = new Set(manifest.files.map((f) => f.path.toLowerCase()));
  return [...taken].flatMap((id) => byId.get(id)!.files).filter((f) => !own.has(f.path.toLowerCase()));
}

export async function fetchManifest(url: string, fetchImpl: Fetch = fetch): Promise<PackManifest> {
  let res: Response;
  try {
    // cache-busting: GitHub release downloads are served through a CDN
    res = await fetchImpl(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, { signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new UserError('Не удалось скачать список модов сборки. Проверьте интернет.');
  }
  if (res.status === 404) throw new UserError('Сборка модов ещё не опубликована. Напишите администратору.');
  if (!res.ok) throw new UserError(`Не удалось скачать список модов сборки (HTTP ${res.status}).`);
  return validateManifest(await res.json());
}

async function loadState(gameDir: string): Promise<PackState> {
  try {
    const s = JSON.parse(await readFile(path.join(gameDir, STATE_FILE), 'utf8')) as PackState;
    return { ...s, files: s.files ?? {} };
  } catch {
    return { files: {} };
  }
}

async function saveState(gameDir: string, state: PackState): Promise<void> {
  await writeFile(path.join(gameDir, STATE_FILE), JSON.stringify(state));
}

/** sha1 of a local file, reusing the cached value while size and mtime are unchanged. */
async function localSha1(full: string, rel: string, state: PackState): Promise<string | null> {
  let st;
  try {
    st = await stat(full);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  const cached = state.files[rel];
  if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) return cached.sha1;
  const sha1 = await hashFile(full);
  state.files[rel] = { size: st.size, mtimeMs: st.mtimeMs, sha1 };
  return sha1;
}

export interface SyncProgress {
  (step: 'check' | 'download' | 'config', fraction: number | null, detail?: string): void;
}

export interface SyncOptions {
  gameDir: string;
  manifest: PackManifest;
  onProgress?: SyncProgress;
  fetchImpl?: Fetch;
  /** Re-apply configs even if config.zip didn't change ("Проверить файлы"). */
  forceOverrides?: boolean;
  /** Ids of the optional mods the player switched on. */
  optionalMods?: string[];
}

export interface SyncResult {
  downloaded: string[];
  removed: string[];
  overridesApplied: boolean;
}

const key = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);

export async function syncPack(opts: SyncOptions): Promise<SyncResult> {
  const { gameDir, manifest, onProgress, fetchImpl = fetch } = opts;
  await mkdir(gameDir, { recursive: true });
  const state = await loadState(gameDir);

  // 1. What is missing or different. Disabled optional mods are simply not wanted, so step 3 removes them.
  const allFiles = [...manifest.files, ...optionalFiles(manifest, opts.optionalMods ?? [])];
  const needed: PackFile[] = [];
  for (let i = 0; i < allFiles.length; i++) {
    const f = allFiles[i]!;
    onProgress?.('check', i / Math.max(1, allFiles.length), f.path);
    const sha1 = await localSha1(path.join(gameDir, ...f.path.split('/')), f.path, state);
    if (sha1 !== f.sha1.toLowerCase()) needed.push(f);
  }

  // 2. Download, 8 at a time, each verified by sha1.
  const totalBytes = needed.reduce((n, f) => n + f.size, 0);
  let doneBytes = 0;
  const report = (detail?: string) => onProgress?.('download', totalBytes ? doneBytes / totalBytes : null, detail);
  const failures = await runPool(needed, CONCURRENCY, async (f) => {
    const dest = path.join(gameDir, ...f.path.split('/'));
    report(f.path);
    await downloadFile({
      url: fileUrls(f.url),
      dest,
      hash: { algorithm: 'sha1', value: f.sha1 },
      fetchImpl,
      onBytes: (d) => {
        doneBytes += d;
        report(f.path);
      },
    });
    const st = await stat(dest);
    state.files[f.path] = { size: st.size, mtimeMs: st.mtimeMs, sha1: f.sha1.toLowerCase() };
  });
  if (failures.length) {
    await saveState(gameDir, state);
    const list = failures
      .slice(0, 5)
      .map(({ item, error }) => `${item.path} (${error instanceof Error ? error.message : String(error)})`)
      .join('\n');
    const more = failures.length > 5 ? `\nи ещё ${failures.length - 5}` : '';
    throw new UserError(`Не удалось скачать файлы сборки:\n${list}${more}\n\nПопробуйте ещё раз позже.`);
  }

  // 3. Remove what the pack no longer has (top level of managed dirs only; subfolders are mod data).
  const wanted = new Set(allFiles.map((f) => key(f.path)));
  const removed: string[] = [];
  for (const dir of manifest.managedDirs) {
    let entries;
    try {
      entries = await readdir(path.join(gameDir, dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const rel = `${dir}/${e.name}`;
      if (!e.isFile() || wanted.has(key(rel))) continue;
      await rm(path.join(gameDir, dir, e.name), { force: true });
      delete state.files[rel];
      removed.push(rel);
    }
  }

  // 4. Configs: re-applied only when config.zip itself changed, so a mods-only update keeps the
  // player's config edits. "Проверить файлы" forces it.
  let overridesApplied = false;
  const o = manifest.overrides;
  if (o && (opts.forceOverrides || state.overridesSha1 !== o.sha1)) {
    onProgress?.('config', null, 'config.zip');
    const tmp = path.join(gameDir, '.launcher-tmp', 'config.zip');
    await downloadFile({ url: o.url, dest: tmp, hash: { algorithm: 'sha1', value: o.sha1 }, fetchImpl }).catch((err) => {
      throw new UserError(`Не удалось скачать настройки сборки (config.zip): ${err instanceof Error ? err.message : err}`);
    });
    // A selective publish touches only the listed files of an existing install (and a repair restores everything).
    const only = state.overridesSha1 && !opts.forceOverrides ? o.only : undefined;
    await extractOverrides(tmp, gameDir, manifest.firstInstallOnly, only);
    await rm(path.dirname(tmp), { recursive: true, force: true });
    state.overridesSha1 = o.sha1;
    overridesApplied = true;
  }

  state.packVersion = manifest.packVersion;
  await saveState(gameDir, state);
  return { downloaded: needed.map((f) => f.path), removed, overridesApplied };
}

/** `**` matches across folders, `*` inside one name (same rules as tools/pack). */
export function globToRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*' && pattern[i + 1] === '*') {
      re += pattern[i + 2] === '/' ? '(?:.*/)?' : '.*';
      i += pattern[i + 2] === '/' ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

export async function extractOverrides(zipFile: string, gameDir: string, firstInstallOnly: string[], only?: string[]): Promise<number> {
  const onlyRes = only?.map(globToRegExp);
  const keepIfExists = new Set(firstInstallOnly.map(key));
  const zip = await open(zipFile);
  let written = 0;
  try {
    for await (const entry of walkEntriesGenerator(zip)) {
      const name = entry.fileName;
      if (name.endsWith('/')) continue;
      if (!isSafeRelativePath(name)) throw new UserError(`config.zip содержит неверный путь: ${name}`);
      if (onlyRes && !onlyRes.some((r) => r.test(name))) continue;
      const dest = path.join(gameDir, ...name.split('/'));
      if (keepIfExists.has(key(name))) {
        const exists = await stat(dest).then(
          () => true,
          () => false,
        );
        if (exists) continue;
      }
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, await readEntry(zip, entry));
      written++;
    }
  } finally {
    zip.close();
  }
  return written;
}
