import { rm } from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell, type IpcMainInvokeEvent } from 'electron';
import { GAME_DIR_NAME, IPC } from '../shared/constants';
import type { GameState, IpcResult, LauncherState, Progress, Settings, UpdateState } from '../shared/types';
import { ApiClient } from './api';
import { UserError } from './errors';
import { clearMarkers } from './install/game';
import { STATE_FILE } from './install/pack';
import { initLog, log } from './log';
import { pingServer } from './ping';
import { isGameRunning, play } from './play';
import { SessionStore } from './session';
import { SettingsStore, totalMemoryMb } from './settings';
import { initUpdater, installUpdate } from './updater';

const DEFAULT_API_ROOT = (import.meta.env.MAIN_VITE_API_ROOT || 'https://the-age-after.up.railway.app').replace(/\/+$/, '');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId('ru.theageafter.launcher');
  void app.whenReady().then(main);
}

let win: BrowserWindow | null = null;

function send(channel: string, payload: unknown) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1080,
    height: 700,
    minWidth: 920,
    minHeight: 620,
    show: false,
    backgroundColor: '#15120e',
    autoHideMenuBar: true,
    title: 'The Age After',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => {
    win = null;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

function main() {
  const userData = app.getPath('userData');
  initLog(path.join(userData, 'logs'));
  log.info(`The Age After launcher ${app.getVersion()} starting`);

  const settings = new SettingsStore(path.join(userData, 'settings.json'), path.join(app.getPath('appData'), GAME_DIR_NAME));
  const session = new SessionStore(path.join(userData, 'session.json'), {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (s) => safeStorage.encryptString(s).toString('base64'),
    decrypt: (s) => safeStorage.decryptString(Buffer.from(s, 'base64')),
  });
  const apiRoot = () => settings.get().apiRoot || DEFAULT_API_ROOT;
  const api = new ApiClient(apiRoot, app.getVersion());
  let forceOverrides = false;

  const token = () => {
    const t = session.accessToken;
    if (!t) throw new UserError('Сначала войдите.', 'session_expired');
    return t;
  };
  /** A 401 from the server means the stored login is dead: forget it. */
  const authed = async <T>(fn: (t: string) => Promise<T>): Promise<T> => {
    try {
      return await fn(token());
    } catch (err) {
      if (err instanceof UserError && err.code === 'session_expired') session.clear();
      throw err;
    }
  };

  const handlers: Record<string, (...args: never[]) => unknown> = {
    getState: (): LauncherState => ({
      profile: session.profile,
      settings: settings.get(),
      defaultApiRoot: DEFAULT_API_ROOT,
      apiRoot: apiRoot(),
      version: app.getVersion(),
      totalMemoryMb: totalMemoryMb(),
    }),
    login: async (login: string, password: string) => {
      const res = await api.authenticate(String(login), String(password), session.clientToken);
      if (!res.selectedProfile) throw new UserError('У аккаунта нет игрового профиля.');
      session.set(res.accessToken, res.selectedProfile);
      log.info(`logged in as ${res.selectedProfile.name}`);
      return res.selectedProfile;
    },
    logout: async () => {
      const t = session.accessToken;
      session.clear();
      if (t) await api.invalidate(t, session.clientToken).catch(() => {});
    },
    register: (username: string, email: string, password: string) => api.register(username, email, password),
    resendVerification: (login: string) => api.resendVerification(login),
    forgotPassword: (login: string) => api.forgotPassword(login),
    me: () => authed((t) => api.me(t)),
    changePassword: (oldPassword: string, newPassword: string) =>
      authed((t) => api.changePassword(t, oldPassword, newPassword)),
    uploadSkin: (png: string, model: 'classic' | 'slim') => authed((t) => api.uploadSkin(t, png, model)),
    setSkinModel: (model: 'classic' | 'slim') => authed((t) => api.setSkinModel(t, model)),
    resetSkin: () => authed((t) => api.resetSkin(t)),
    getNews: () => api.news(),
    getServerConfig: () => api.config(),
    pingServer: async () => pingServer((await api.config()).serverAddress),
    play: async () => {
      const current = settings.get();
      await play({
        settings: current,
        api,
        apiRoot: apiRoot(),
        session,
        forceOverrides,
        emitProgress: (p: Progress) => send(IPC.progress, p),
        emitGameState: (s: GameState) => send(IPC.gameState, s),
        onWindowReady: () => {
          if (settings.get().hideWhilePlaying) win?.hide();
        },
        onExit: () => {
          if (!win || win.isDestroyed() || settings.get().hideWhilePlaying) app.quit();
          else win.show();
        },
      });
      forceOverrides = false;
    },
    saveSettings: (patch: Partial<Settings>) => {
      if (isGameRunning() && patch.gameDir) throw new UserError('Закройте игру, чтобы сменить папку.');
      return settings.update(patch);
    },
    chooseGameDir: async () => {
      const res = await dialog.showOpenDialog(win!, {
        title: 'Папка для игры',
        defaultPath: settings.get().gameDir,
        properties: ['openDirectory', 'createDirectory'],
      });
      return res.canceled ? null : (res.filePaths[0] ?? null);
    },
    openGameDir: async () => {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(settings.get().gameDir, { recursive: true });
      await shell.openPath(settings.get().gameDir);
    },
    openLogs: async () => {
      await shell.openPath(path.join(userData, 'logs'));
    },
    repair: async () => {
      if (isGameRunning()) throw new UserError('Сначала закройте игру.');
      const dir = settings.get().gameDir;
      await clearMarkers(dir);
      await rm(path.join(dir, STATE_FILE), { force: true });
      forceOverrides = true;
    },
    installUpdate: () => installUpdate(),
  };

  ipcMain.handle(IPC.invoke, async (event: IpcMainInvokeEvent, method: string, ...args: unknown[]): Promise<IpcResult<unknown>> => {
    if (!win || event.sender !== win.webContents) return { ok: false, error: 'forbidden' };
    const handler = Object.hasOwn(handlers, method) ? handlers[method] : undefined;
    if (!handler) return { ok: false, error: `unknown method ${method}` };
    try {
      return { ok: true, data: await (handler as (...a: unknown[]) => unknown)(...args) };
    } catch (err) {
      if (err instanceof UserError) return { ok: false, error: err.message, code: err.code };
      log.error(`${method} failed`, err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  createWindow();
  initUpdater((u: UpdateState) => send(IPC.update, u));

  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.on('window-all-closed', () => {
    // Keep running while the game is up only if the window was hidden on purpose.
    if (!isGameRunning()) app.quit();
  });
}
