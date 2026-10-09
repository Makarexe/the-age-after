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

export interface PackManifest {
  formatVersion: number;
  packVersion: string;
  minecraft: string;
  neoforge: string;
  files: PackFile[];
  overrides: { url: string; sha1: string; size: number } | null;
  managedDirs: string[];
  firstInstallOnly: string[];
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
  for (const f of m.files) {
    if (!isSafeRelativePath(f.path) || !/^[0-9a-f]{40}$/i.test(f.sha1) || !/^https:\/\//.test(f.url)) {
      throw new UserError(`Манифест сборки содержит неверную запись: ${String(f.path)}`);
    }
  }
  for (const d of [...(m.managedDirs ?? []), ...(m.firstInstallOnly ?? [])]) {
    if (!isSafeRelativePath(d)) throw new UserError(`Манифест сборки содержит неверный путь: ${d}`);
  }
  return { ...m, managedDirs: m.managedDirs ?? [], firstInstallOnly: m.firstInstallOnly ?? [] };
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
  /** Re-apply configs even if packVersion didn't change ("переустановить"). */
  forceOverrides?: boolean;
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

  // 1. What is missing or different.
  const needed: PackFile[] = [];
  for (let i = 0; i < manifest.files.length; i++) {
    const f = manifest.files[i]!;
    onProgress?.('check', i / Math.max(1, manifest.files.length), f.path);
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
      url: f.url,
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
  const wanted = new Set(manifest.files.map((f) => key(f.path)));
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

  // 4. Configs: re-applied when the pack version changes.
  let overridesApplied = false;
  const o = manifest.overrides;
  if (o && (opts.forceOverrides || state.packVersion !== manifest.packVersion || state.overridesSha1 !== o.sha1)) {
    onProgress?.('config', null, 'config.zip');
    const tmp = path.join(gameDir, '.launcher-tmp', 'config.zip');
    await downloadFile({ url: o.url, dest: tmp, hash: { algorithm: 'sha1', value: o.sha1 }, fetchImpl }).catch((err) => {
      throw new UserError(`Не удалось скачать настройки сборки (config.zip): ${err instanceof Error ? err.message : err}`);
    });
    await extractOverrides(tmp, gameDir, manifest.firstInstallOnly);
    await rm(path.dirname(tmp), { recursive: true, force: true });
    state.overridesSha1 = o.sha1;
    overridesApplied = true;
  }

  state.packVersion = manifest.packVersion;
  await saveState(gameDir, state);
  return { downloaded: needed.map((f) => f.path), removed, overridesApplied };
}

export async function extractOverrides(zipFile: string, gameDir: string, firstInstallOnly: string[]): Promise<number> {
  const keepIfExists = new Set(firstInstallOnly.map(key));
  const zip = await open(zipFile);
  let written = 0;
  try {
    for await (const entry of walkEntriesGenerator(zip)) {
      const name = entry.fileName;
      if (name.endsWith('/')) continue;
      if (!isSafeRelativePath(name)) throw new UserError(`config.zip содержит неверный путь: ${name}`);
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
