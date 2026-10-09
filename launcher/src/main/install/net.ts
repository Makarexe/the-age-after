import type { ResolvedLibrary } from '@xmcl/core';
import { Agent, interceptors, type Dispatcher } from 'undici';

export const MOJANG_ASSETS = 'https://resources.download.minecraft.net';
/** BMCLAPI: a public mirror of Mojang's and the Forge/NeoForge mavens; every file is still sha1-checked. */
export const BMCLAPI = 'https://bmclapi2.bangbang93.com';

let agent: Dispatcher | undefined;

/** Built like @xmcl/file-transfer's getDefaultAgent (retry + redirect interceptors, which it relies on). */
export function createDownloadAgent(connections = 16): Dispatcher {
  return new Agent({ connections, connectTimeout: 30_000, headersTimeout: 60_000, bodyTimeout: 120_000 }).compose(
    interceptors.retry(),
    interceptors.redirect({ maxRedirections: 5 }),
  );
}

/**
 * @xmcl/file-transfer creates a new agent for every file when none is given, so its 16-connection
 * cap is per file and all ~3,700 assets of 1.21.1 start at once; on a slow connection many time
 * out. One shared agent makes the cap real and queues the rest.
 */
export function downloadAgent(): Dispatcher {
  agent ??= createDownloadAgent();
  return agent;
}

/** Official URL first, the mirror only if it fails. */
export function libraryUrls(library: ResolvedLibrary): string[] {
  const urls = [library.download.url];
  if (library.download.path) urls.push(`${BMCLAPI}/maven/${library.download.path}`);
  return urls.filter(Boolean);
}

export const assetHosts = [MOJANG_ASSETS, `${BMCLAPI}/assets`];

/** Readable summary of a download failure, including which files failed and why. */
export function describeError(err: unknown, limit = 3): string {
  if (err instanceof AggregateError) {
    const inner = err.errors.slice(0, limit).map((e) => describeError(e, 0));
    const more = err.errors.length > limit ? ` и ещё ${err.errors.length - limit}` : '';
    return `не скачалось файлов: ${err.errors.length} (${inner.join('; ')}${more})`;
  }
  if (err instanceof Error) {
    const url = (err as { url?: unknown }).url;
    const code = (err as { code?: unknown }).code;
    return [err.message || err.name, code && `[${String(code)}]`, url && `— ${String(url)}`].filter(Boolean).join(' ');
  }
  if (err && typeof err === 'object') return JSON.stringify(err).slice(0, 300);
  return String(err);
}
