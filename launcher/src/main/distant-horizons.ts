// The pack's configs ship Distant Horizons' renderer switched off; a player who ticked the optional mod wants it.
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Turns `rendererMode = "DISABLED"` back into "DEFAULT" in config/DistantHorizons.toml. Returns true if the file
 * changed. No file yet: nothing to do, the mod creates it with rendering on. Receiving LODs from the server is on
 * by default and needs no client setting.
 */
export async function ensureDistantHorizonsRendering(gameDir: string): Promise<boolean> {
  const file = path.join(gameDir, 'config', 'DistantHorizons.toml');
  const text = await readFile(file, 'utf8').catch((err: NodeJS.ErrnoException) => (err.code === 'ENOENT' ? null : Promise.reject(err)));
  if (text === null) return false;
  const next = text.replace(/^(\s*rendererMode\s*=\s*)"DISABLED"/m, '$1"DEFAULT"');
  if (next === text) return false;
  await writeFile(`${file}.tmp`, next);
  await rename(`${file}.tmp`, file);
  return true;
}
