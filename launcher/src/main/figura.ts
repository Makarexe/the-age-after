// Figura's cloud (avatars) checks players through the session server. Ours only knows our
// accounts, so the launcher points Figura at our own cloud (Sculptor) instead of the official one.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** The version Figura 0.1.x writes; a file without it is read as the current format. */
const FIGURA_CONFIG_VERSION = 1;

/**
 * Sets "Figura Cloud IP" (`server_ip` in config/figura.json), keeping the player's other Figura
 * settings. Returns true if the file was changed. A file we can't parse is left alone.
 */
export async function ensureFiguraServer(gameDir: string, host: string): Promise<boolean> {
  const file = path.join(gameDir, 'config', 'figura.json');
  let config: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    config = parsed as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return false;
  }
  if (config.server_ip === host) return false;
  const updated = { CONFIG_VERSION: FIGURA_CONFIG_VERSION, ...config, server_ip: host };
  const tmp = `${file}.tmp`;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(tmp, JSON.stringify(updated, null, 2));
  await rename(tmp, file);
  return true;
}
