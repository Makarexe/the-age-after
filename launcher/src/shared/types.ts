// Types shared by the main process, preload and renderer.

export interface Profile {
  id: string;
  name: string;
}

export interface Me {
  id: string;
  username: string;
  email: string;
  status: string;
  isAdmin: boolean;
  skin: { url: string; model: 'classic' | 'slim' } | null;
  createdAt: string;
}

export interface NewsItem {
  id: number;
  title: string;
  body: string;
  createdAt: string;
}

export interface ServerConfig {
  serverName: string;
  serverAddress: string;
  packManifestUrl: string;
  /** host of our Figura cloud; absent or '' on servers without one */
  figuraServer?: string;
  apiRoot: string;
}

export interface Settings {
  /** -Xmx in megabytes */
  memoryMb: number;
  gameDir: string;
  /** Hide the launcher while the game runs, close it when the game exits. */
  hideWhilePlaying: boolean;
  /** Overrides the built-in account server address; empty = default. */
  apiRoot: string;
}

export interface LauncherState {
  profile: Profile | null;
  settings: Settings;
  defaultApiRoot: string;
  apiRoot: string;
  version: string;
  totalMemoryMb: number;
}

export interface RegisterResult {
  status: 'pending_email' | 'pending_approval' | 'active';
  mailSent: boolean;
}

export type ProgressStage = 'prepare' | 'java' | 'minecraft' | 'neoforge' | 'authlib' | 'mods' | 'config' | 'launch';

export interface Progress {
  stage: ProgressStage;
  label: string;
  /** 0..1, or null when the size of the work is unknown */
  fraction: number | null;
  detail?: string;
}

export type GameState =
  | { state: 'idle' }
  | { state: 'preparing' }
  | { state: 'running' }
  | { state: 'exited'; code: number | null; crashed: boolean; crashReport?: string }
  | { state: 'error'; message: string };

export interface ServerStatus {
  online: boolean;
  players?: { online: number; max: number };
  version?: string;
  motd?: string;
  latencyMs?: number;
}

export type UpdateState =
  | { state: 'none' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'ready'; version: string };

/** What the preload exposes as `window.launcher`. All methods throw Error with a user-facing message. */
export interface LauncherApi {
  getState(): Promise<LauncherState>;
  login(login: string, password: string): Promise<Profile>;
  logout(): Promise<void>;
  register(username: string, email: string, password: string): Promise<RegisterResult>;
  resendVerification(login: string): Promise<void>;
  forgotPassword(login: string): Promise<void>;
  me(): Promise<Me>;
  changePassword(oldPassword: string, newPassword: string): Promise<void>;
  uploadSkin(pngBase64: string, model: 'classic' | 'slim'): Promise<Me>;
  setSkinModel(model: 'classic' | 'slim'): Promise<Me>;
  resetSkin(): Promise<Me>;
  getNews(): Promise<NewsItem[]>;
  getServerConfig(): Promise<ServerConfig>;
  pingServer(): Promise<ServerStatus>;
  play(): Promise<void>;
  saveSettings(settings: Partial<Settings>): Promise<Settings>;
  chooseGameDir(): Promise<string | null>;
  openGameDir(): Promise<void>;
  openLogs(): Promise<void>;
  repair(): Promise<void>;
  installUpdate(): Promise<void>;
  onProgress(listener: (p: Progress) => void): () => void;
  onGameState(listener: (s: GameState) => void): () => void;
  onUpdate(listener: (u: UpdateState) => void): () => void;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: 'session_expired' };
