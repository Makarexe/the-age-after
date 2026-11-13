// The libraries the NeoForge installer needs from maven.neoforged.net, as one zip for our Release: some
// players can't reach that host (it answers with timeouts or empty files). Mojang's own hosts are left alone.
import { createHash } from 'node:crypto';
import { createZip, readZipEntry } from './zip.mjs';

const MOJANG_HOST = 'libraries.minecraft.net';
const ZIP_MTIME = new Date(2020, 0, 1);

/** Non-Mojang library artifacts of the installer (install_profile.json + version.json), by path. */
export function neoForgeLibraries(installerJar) {
  const libs = new Map();
  for (const name of ['install_profile.json', 'version.json']) {
    const entry = readZipEntry(installerJar, name);
    if (!entry) throw new Error(`В установщике NeoForge нет ${name}`);
    for (const lib of JSON.parse(entry.toString('utf8')).libraries ?? []) {
      const a = lib.downloads?.artifact;
      if (!a?.url || !a.path || new URL(a.url).host === MOJANG_HOST) continue;
      libs.set(a.path, a);
    }
  }
  return [...libs.values()].sort((x, y) => x.path.localeCompare(y.path));
}

/** @returns {Promise<{ zip: Buffer, files: number }>} */
export async function buildNeoForgeLibrariesZip(installerJar, fetchImpl = fetch) {
  const entries = [];
  for (const a of neoForgeLibraries(installerJar)) {
    let data;
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetchImpl(a.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = Buffer.from(await res.arrayBuffer());
        if (createHash('sha1').update(data).digest('hex') !== a.sha1) throw new Error('sha1 не совпал');
        break;
      } catch (err) {
        if (attempt === 3) throw new Error(`${a.url}: ${err.message}`);
      }
    }
    entries.push({ name: `libraries/${a.path}`, data, mtime: ZIP_MTIME });
  }
  return { zip: createZip(entries), files: entries.length };
}
