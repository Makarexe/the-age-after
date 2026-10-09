import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateState } from '../shared/types';
import { log } from './log';

/** Launcher updates from the public GitHub Releases (electron-builder `publish`). */
export function initUpdater(emit: (u: UpdateState) => void): void {
  if (!app.isPackaged) return;
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
  autoUpdater.quitAndInstall(false, true);
}
