import type { JavaRuntimeManifest, JavaRuntimes } from '@xmcl/installer';
import type { Fetch } from './download';

/** Mojang's index of Java runtimes (the same URL @xmcl/installer uses). */
export const JAVA_RUNTIME_INDEX_URL =
  'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';

export function javaPlatformKey(platform: NodeJS.Platform = process.platform, arch: string = process.arch): keyof JavaRuntimes {
  if (platform === 'win32') return arch === 'arm64' ? 'windows-arm64' : arch === 'ia32' ? 'windows-x86' : 'windows-x64';
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  return arch === 'ia32' ? 'linux-i386' : 'linux';
}

async function getJson<T>(url: string, fetchImpl: Fetch): Promise<T> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return (await res.json()) as T;
}

/**
 * Replacement for fetchJavaRuntimeManifest from @xmcl/installer 6.1.2: it passes `throwOnError` to
 * undici 7, which rejects that option ("invalid throwOnError"), so it can never succeed.
 */
export async function fetchJavaManifest(component: string, fetchImpl: Fetch = fetch): Promise<JavaRuntimeManifest> {
  const index = await getJson<JavaRuntimes>(JAVA_RUNTIME_INDEX_URL, fetchImpl);
  const platformKey = javaPlatformKey();
  const target = index[platformKey]?.[component]?.[0];
  if (!target) throw new Error(`Mojang не публикует Java «${component}» для ${platformKey}`);
  const manifest = await getJson<{ files: JavaRuntimeManifest['files'] }>(target.manifest.url, fetchImpl);
  return { files: manifest.files, target: component, version: target.version };
}
