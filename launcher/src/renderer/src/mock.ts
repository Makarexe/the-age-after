// Fake bridge for `npm run preview:ui`: the UI in a normal browser, without Electron.
import type { GameState, LauncherState, Me, Progress } from '../../shared/types';

export function installMock() {
  const listeners: Record<string, ((p: unknown) => void)[]> = { progress: [], gameState: [], update: [] };
  const emit = (ch: string, p: unknown) => listeners[ch]!.forEach((l) => l(p));
  const params = new URLSearchParams(location.search);
  let state: LauncherState = {
    profile: params.has('login') ? null : { id: 'a74d5f2017e33501824aa3cad0ceeba8', name: 'Makar' },
    settings: { memoryMb: 6144, gameDir: 'C:\\Users\\makar\\AppData\\Roaming\\.theageafter', hideWhilePlaying: false, apiRoot: '' },
    defaultApiRoot: 'https://the-age-after.up.railway.app',
    apiRoot: 'https://the-age-after.up.railway.app',
    version: '0.1.0',
    totalMemoryMb: 16384,
  };
  const me: Me = { id: 'a74d', username: 'Makar', email: 'm@example.com', status: 'active', isAdmin: true, skin: null, createdAt: new Date().toISOString() };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const handlers: Record<string, (...a: never[]) => unknown> = {
    getState: () => state,
    login: async () => {
      await sleep(400);
      return { id: 'a74d', name: 'Makar' };
    },
    logout: () => undefined,
    register: async () => ({ status: 'pending_email', mailSent: true }),
    resendVerification: () => undefined,
    forgotPassword: () => undefined,
    me: () => me,
    getNews: () => [
      { id: 2, title: 'Сервер обновлён до сборки 2026.10.09', body: 'Добавили Create: Steam & Rails и поправили конфиги JEI.\nЛаунчер сам всё скачает.', createdAt: new Date().toISOString() },
      { id: 1, title: 'Добро пожаловать!', body: 'Теперь вход по своим аккаунтам — ник подделать нельзя.', createdAt: new Date(Date.now() - 86400e3 * 3).toISOString() },
    ],
    getServerConfig: () => ({ serverName: 'The Age After', serverAddress: 'play.theageafter.ru', packManifestUrl: '', apiRoot: state.apiRoot }),
    pingServer: () => ({ online: true, players: { online: 3, max: 20 }, latencyMs: 42, version: 'NeoForge 1.21.1', motd: 'Эпоха после — выживание с модами' }),
    play: async () => {
      emit('gameState', { state: 'preparing' } satisfies GameState);
      const steps: [Progress['stage'], string][] = [
        ['minecraft', 'Устанавливаем Minecraft'],
        ['java', 'Устанавливаем Java'],
        ['mods', 'Скачиваем моды'],
      ];
      for (const [stage, label] of steps) {
        for (let i = 0; i <= 10; i++) {
          emit('progress', { stage, label, fraction: i / 10, detail: stage === 'mods' ? `mods/create-1.21.1-6.0.${i}.jar` : undefined } satisfies Progress);
          await sleep(120);
        }
      }
      emit('gameState', { state: 'running' } satisfies GameState);
    },
    saveSettings: (patch: Partial<LauncherState['settings']>) => {
      state = { ...state, settings: { ...state.settings, ...patch } };
      return state.settings;
    },
    chooseGameDir: () => null,
    openGameDir: () => undefined,
    openLogs: () => undefined,
    repair: () => undefined,
    changePassword: () => undefined,
    uploadSkin: () => me,
    setSkinModel: () => me,
    resetSkin: () => me,
    installUpdate: () => undefined,
  };
  window.launcherBridge = {
    invoke: async (method, ...args) => {
      try {
        return { ok: true, data: await (handlers[method] as (...a: unknown[]) => unknown)(...args) };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
    on: (ch, l) => {
      listeners[ch]!.push(l);
      return () => {
        listeners[ch] = listeners[ch]!.filter((x) => x !== l);
      };
    },
  };
}
