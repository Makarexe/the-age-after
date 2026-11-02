// Dimensional Doors ships its own copies of vanilla blockstates/models (terracotta, sand, deepslate…)
// without rotations. Our resource pack restores the vanilla ones; it must be enabled and sit above the mods' pack.
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const FIX_PACK = 'vanilla-blockstates-fix.zip';
const PACK_ID = `file/${FIX_PACK}`;

/**
 * Adds the pack to the `resourcePacks` line of options.txt right after "mod_resources" (the mods' assets):
 * above them, but below any pack the player chose. Returns null if nothing has to change.
 */
export function withPackEnabled(options: string): string | null {
  const m = options.match(/^resourcePacks:(\[.*\])\s*$/m);
  if (!m && /^resourcePacks:/m.test(options)) return null; // a line we can't read: not ours to repair
  if (!m) return `${options}${options && !options.endsWith('\n') ? '\n' : ''}resourcePacks:["vanilla","mod_resources",${JSON.stringify(PACK_ID)}]\n`;
  let list: unknown;
  try {
    list = JSON.parse(m[1]!);
  } catch {
    return null; // not ours to repair
  }
  if (!Array.isArray(list) || list.includes(PACK_ID)) return null;
  const at = list.indexOf('mod_resources') + 1;
  list.splice(at || list.length, 0, PACK_ID);
  return options.replace(m[0], `resourcePacks:${JSON.stringify(list)}`);
}

/** Copies the pack into resourcepacks/ (when missing or different) and turns it on. Returns true if anything changed. */
export async function ensureFixPack(gameDir: string, srcZip: string): Promise<boolean> {
  const dest = path.join(gameDir, 'resourcepacks', FIX_PACK);
  const src = await readFile(srcZip);
  const have = await readFile(dest).catch(() => null);
  let changed = false;
  if (!have || !have.equals(src)) {
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(srcZip, dest);
    changed = true;
  }
  const file = path.join(gameDir, 'options.txt');
  const current = await readFile(file, 'utf8').catch((err: NodeJS.ErrnoException) => (err.code === 'ENOENT' ? '' : null));
  if (current === null) return changed;
  const next = withPackEnabled(current);
  if (next === null) return changed;
  await writeFile(`${file}.tmp`, next);
  await rename(`${file}.tmp`, file);
  return true;
}

