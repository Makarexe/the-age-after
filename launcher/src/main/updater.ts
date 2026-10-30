import { app, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateState } from '../shared/types';
import { log } from './log';

/** Launcher updates from the public GitHub Releases (electron-builder `publish`). */
const RELEASES = 'https://github.com/Makarexe/the-age-after/releases/latest';

/** True if dotted version `a` is newer than `b`. */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

async function checkManually(emit: (u: UpdateState) => void): Promise<void> {
  const res = await fetch('https://api.github.com/repos/Makarexe/the-age-after/releases/latest', { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return;
  const version = String(((await res.json()) as { tag_name?: string }).tag_name ?? '').replace(/^v/, '');
  if (/^\d+(\.\d+)*$/.test(version) && isNewer(version, app.getVersion())) emit({ state: 'manual', version });
}

export function initUpdater(emit: (u: UpdateState) => void): void {
  if (!app.isPackaged) return;
  if (process.platform === 'darwin') {
    // Squirrel.Mac refuses unsigned updates, so autoUpdater can't be used here.
    const check = () => checkManually(emit).catch((err) => log.warn('update check failed', err));
    void check();
    setInterval(check, 4 * 60 * 60 * 1000).unref();
    return;
  }
  autoUpdater.logger = { info: log.info, warn: log.warn, error: log.error, debug: () => {} };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (info) => emit({ state: 'available', version: info.version }));
  autoUpdater.on('download-progress', (p) => emit({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => emit({ state: 'ready', version: info.version }));
  autoUpdater.on('error', (err) => log.warn('updater error', err));
  const check = () => autoUpdater.checkForUpdates().catch((err) => log.warn('update check failed', err));
  void check();
  setInterval(check, 4 * 60 * 60 * 1000).unref();
}

export function installUpdate(): void {
  if (process.platform === 'darwin') {
    void shell.openExternal(RELEASES);
    return;
  }
  autoUpdater.quitAndInstall(false, true);
}
