import { describe, expect, it } from 'vitest';
import { fetchJavaManifest, JAVA_RUNTIME_INDEX_URL, javaPlatformKey } from '../src/main/install/java-manifest';

describe('fetchJavaManifest', () => {
  it('picks the runtime for this platform and returns its file list', async () => {
    const key = javaPlatformKey();
    const index = {
      [key]: {
        'java-runtime-delta': [
          { availability: { group: 1, progress: 100 }, manifest: { sha1: 'x', size: 1, url: 'https://piston-meta.test/delta.json' }, version: { name: '21.0.7', released: '2025-01-01' } },
        ],
      },
    };
    const files = { 'bin/javaw.exe': { type: 'file', executable: true, downloads: {} } };
    const requested: string[] = [];
    const fakeFetch = (async (url: string) => {
      requested.push(url);
      const body = url === JAVA_RUNTIME_INDEX_URL ? index : url === 'https://piston-meta.test/delta.json' ? { files } : null;
      return new Response(JSON.stringify(body), { status: body ? 200 : 404 });
    }) as unknown as typeof fetch;

    const manifest = await fetchJavaManifest('java-runtime-delta', fakeFetch);
    expect(manifest).toEqual({ files, target: 'java-runtime-delta', version: { name: '21.0.7', released: '2025-01-01' } });
    expect(requested).toEqual([JAVA_RUNTIME_INDEX_URL, 'https://piston-meta.test/delta.json']);

    await expect(fetchJavaManifest('java-runtime-zeta', fakeFetch)).rejects.toThrow(/java-runtime-zeta/);
  });

  it('maps platforms like the official launcher', () => {
    expect(javaPlatformKey('win32', 'x64')).toBe('windows-x64');
    expect(javaPlatformKey('win32', 'arm64')).toBe('windows-arm64');
    expect(javaPlatformKey('win32', 'ia32')).toBe('windows-x86');
    expect(javaPlatformKey('darwin', 'arm64')).toBe('mac-os-arm64');
    expect(javaPlatformKey('linux', 'x64')).toBe('linux');
  });
});
