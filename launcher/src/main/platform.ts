import path from 'node:path';
import { GAME_DIR_NAME } from '../shared/constants';
import { UserError } from './errors';

/**
 * Game folder: `%APPDATA%\.theageafter` on Windows and `~/Library/Application Support/.theageafter` on macOS
 * (both are Electron's `appData`); on Linux `$XDG_DATA_HOME` or `~/.local/share`, not `~/.config` (that is for settings).
 */
export function defaultGameDir(
  platform: NodeJS.Platform,
  dirs: { appData: string; home: string; xdgDataHome?: string },
): string {
  if (platform === 'linux') return path.join(dirs.xdgDataHome || path.join(dirs.home, '.local', 'share'), GAME_DIR_NAME);
  return path.join(dirs.appData, GAME_DIR_NAME);
}

/** Minecraft 1.21.1 ships no LWJGL natives for Linux ARM and Mojang has no Java runtime for it. */
export function assertPlatformSupported(platform: NodeJS.Platform = process.platform, arch: string = process.arch): void {
  if (platform === 'linux' && arch !== 'x64') {
    throw new UserError(`Linux на процессоре ${arch} не поддерживается: у Minecraft 1.21.1 нет библиотек под него. Нужен Linux x86_64.`);
  }
}

/** True where the launcher can't replace itself: macOS (unsigned build) and Linux outside an AppImage (deb). */
export function needsManualUpdate(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): boolean {
  return platform === 'darwin' || (platform === 'linux' && !env.APPIMAGE);
}
