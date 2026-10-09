import type { GameState, IpcResult, LauncherApi, Progress, UpdateState } from '../../shared/types';

interface Bridge {
  invoke(method: string, ...args: unknown[]): Promise<IpcResult<unknown>>;
  on(channel: 'progress' | 'gameState' | 'update', listener: (payload: unknown) => void): () => void;
}

declare global {
  interface Window {
    launcherBridge: Bridge;
  }
}

export class LauncherError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

export const isSessionExpired = (err: unknown) => err instanceof LauncherError && err.code === 'session_expired';

async function call<T>(method: string, ...args: unknown[]): Promise<T> {
  const res = await window.launcherBridge.invoke(method, ...args);
  if (!res.ok) throw new LauncherError(res.error, res.code);
  return res.data as T;
}

const methods = [
  'getState', 'login', 'logout', 'register', 'resendVerification', 'forgotPassword', 'me', 'changePassword',
  'uploadSkin', 'setSkinModel', 'resetSkin', 'getNews', 'getServerConfig', 'pingServer', 'play', 'saveSettings', 'chooseGameDir',
  'openGameDir', 'openLogs', 'repair', 'installUpdate',
] as const;

export const api = {
  ...(Object.fromEntries(methods.map((m) => [m, (...args: unknown[]) => call(m, ...args)])) as Omit<
    LauncherApi,
    'onProgress' | 'onGameState' | 'onUpdate'
  >),
  onProgress: (l: (p: Progress) => void) => window.launcherBridge.on('progress', l as (p: unknown) => void),
  onGameState: (l: (s: GameState) => void) => window.launcherBridge.on('gameState', l as (p: unknown) => void),
  onUpdate: (l: (u: UpdateState) => void) => window.launcherBridge.on('update', l as (p: unknown) => void),
} satisfies LauncherApi;

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
