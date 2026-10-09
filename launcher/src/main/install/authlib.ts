import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { log } from '../log';
import { UserError } from '../errors';
import { downloadFile, hashFile, type Fetch } from './download';

const LATEST_URL = 'https://authlib-injector.yushi.moe/artifact/latest.json';
const GITHUB_LATEST = 'https://api.github.com/repos/yushijinhun/authlib-injector/releases/latest';

interface Artifact {
  version: string;
  url: string;
  sha256: string;
}

async function fromYushi(fetchImpl: Fetch): Promise<Artifact> {
  const res = await fetchImpl(LATEST_URL, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = (await res.json()) as { version: string; download_url: string; checksums: { sha256: string } };
  return { version: j.version, url: j.download_url, sha256: j.checksums.sha256 };
}

/** Fallback: GitHub releases; assets carry a "sha256:<hex>" digest. */
async function fromGitHub(fetchImpl: Fetch): Promise<Artifact> {
  const res = await fetchImpl(GITHUB_LATEST, {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = (await res.json()) as { tag_name: string; assets: { name: string; browser_download_url: string; digest?: string }[] };
  const asset = j.assets.find((a) => /^authlib-injector-.*\.jar$/.test(a.name));
  const sha256 = asset?.digest?.replace(/^sha256:/, '');
  if (!asset || !sha256) throw new Error('no jar with checksum in the latest release');
  return { version: j.tag_name.replace(/^v/, ''), url: asset.browser_download_url, sha256 };
}

/** Latest authlib-injector, sha256-verified. Offline with a jar already present → keep using it. */
export async function ensureAuthlibInjector(gameDir: string, fetchImpl: Fetch = fetch): Promise<string> {
  const jar = path.join(gameDir, 'authlib-injector.jar');
  const infoFile = path.join(gameDir, 'authlib-injector.json');
  let artifact: Artifact | undefined;
  for (const source of [fromYushi, fromGitHub]) {
    try {
      artifact = await source(fetchImpl);
      break;
    } catch (err) {
      log.warn(`authlib-injector source ${source.name} failed`, err);
    }
  }
  if (!artifact) {
    if (existsSync(jar)) return jar;
    throw new UserError('Не удалось скачать authlib-injector. Проверьте интернет.');
  }
  try {
    const info = JSON.parse(await readFile(infoFile, 'utf8')) as Artifact;
    if (info.sha256 === artifact.sha256 && existsSync(jar) && (await hashFile(jar, 'sha256')) === artifact.sha256) return jar;
  } catch {
    // not installed yet
  }
  try {
    await downloadFile({ url: artifact.url, dest: jar, hash: { algorithm: 'sha256', value: artifact.sha256 }, fetchImpl });
  } catch (err) {
    if (existsSync(jar)) return jar;
    throw new UserError(`Не удалось скачать authlib-injector: ${err instanceof Error ? err.message : err}`);
  }
  await writeFile(infoFile, JSON.stringify(artifact));
  log.info(`authlib-injector ${artifact.version} installed`);
  return jar;
}
