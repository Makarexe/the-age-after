import { mkdtemp, lstat, readlink, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyJavaFileModes } from '../src/main/install/game';
import { assertPlatformSupported, defaultGameDir, needsManualUpdate } from '../src/main/platform';

describe('defaultGameDir', () => {
  it('keeps the Windows and macOS locations (Electron appData)', () => {
    const d = { appData: path.join('/x', 'AppData'), home: '/h' };
    expect(defaultGameDir('win32', d)).toBe(path.join('/x', 'AppData', '.theageafter'));
    expect(defaultGameDir('darwin', { ...d, appData: '/h/Library/Application Support' })).toBe(path.join('/h/Library/Application Support', '.theageafter'));
  });
  it('uses XDG data on Linux, not ~/.config', () => {
    const d = { appData: '/h/.config', home: '/h' };
    expect(defaultGameDir('linux', d)).toBe(path.join('/h', '.local', 'share', '.theageafter'));
    expect(defaultGameDir('linux', { ...d, xdgDataHome: '/data' })).toBe(path.join('/data', '.theageafter'));
  });
});

describe('platform support', () => {
  it('refuses Linux on ARM with a clear message, allows the rest', () => {
    expect(() => assertPlatformSupported('linux', 'arm64')).toThrow(/arm64/);
    expect(() => assertPlatformSupported('linux', 'x64')).not.toThrow();
    expect(() => assertPlatformSupported('darwin', 'arm64')).not.toThrow();
    expect(() => assertPlatformSupported('win32', 'x64')).not.toThrow();
  });
  it('updates by hand on macOS and on Linux outside an AppImage', () => {
    expect(needsManualUpdate('darwin', {})).toBe(true);
    expect(needsManualUpdate('linux', {})).toBe(true);
    expect(needsManualUpdate('linux', { APPIMAGE: '/a.AppImage' })).toBe(false);
    expect(needsManualUpdate('win32', {})).toBe(false);
  });
});

describe('applyJavaFileModes', () => {
  let dir: string;
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('does nothing on Windows', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'jm-'));
    await expect(applyJavaFileModes(dir, { 'bin/java': { type: 'file', executable: true } }, 'win32')).resolves.toBeUndefined();
  });

  it.skipIf(process.platform === 'win32')('makes executables runnable and turns links into symlinks', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'jm-'));
    await mkdir(path.join(dir, 'bin'), { recursive: true });
    await writeFile(path.join(dir, 'bin', 'java'), '#!/bin/sh\n', { mode: 0o644 });
    await writeFile(path.join(dir, 'bin', 'libjli.dylib'), 'hard link stand-in');
    await applyJavaFileModes(dir, {
      'bin/java': { type: 'file', executable: true },
      'bin/libjli.dylib': { type: 'link', target: 'java' },
    });
    expect((await lstat(path.join(dir, 'bin', 'java'))).mode & 0o111).toBeTruthy();
    expect(await readlink(path.join(dir, 'bin', 'libjli.dylib'))).toBe('java');
  });
});
