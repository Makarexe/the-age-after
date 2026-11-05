import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { javaPaths } from '../src/main/install/game';
import { isNewer } from '../src/main/updater';

describe('javaPaths', () => {
  it('uses the jre.bundle layout of Mojang macOS runtimes', () => {
    const p = javaPaths('/g', 'java-runtime-delta', 'darwin');
    expect(p.java).toBe(path.join('/g', 'runtime', 'java-runtime-delta', 'jre.bundle', 'Contents', 'Home', 'bin', 'java'));
    expect(p.root).toBe(path.join('/g', 'runtime', 'java-runtime-delta'));
  });
  it('keeps the Windows and Linux layout', () => {
    expect(javaPaths('/g', 'c', 'win32').javaw).toBe(path.join('/g', 'runtime', 'c', 'bin', 'javaw.exe'));
    expect(javaPaths('/g', 'c', 'linux').java).toBe(path.join('/g', 'runtime', 'c', 'bin', 'java'));
  });
});

describe('isNewer', () => {
  it('compares dotted versions numerically', () => {
    expect(isNewer('0.1.12', '0.1.9')).toBe(true);
    expect(isNewer('0.2', '0.1.12')).toBe(true);
    expect(isNewer('0.1.12', '0.1.12')).toBe(false);
    expect(isNewer('0.1.11', '0.1.12')).toBe(false);
  });
});
