import type { Me, NewsItem, Profile, RegisterResult, ServerConfig } from '../shared/types';
import { USER_AGENT } from '../shared/constants';
import { sessionExpired, UserError } from './errors';

const TIMEOUT_MS = 20_000;

export interface AuthResponse {
  accessToken: string;
  clientToken: string;
  selectedProfile?: Profile;
}

/** HTTP client for the account server. Errors come back as UserError with the server's Russian text. */
export class ApiClient {
  constructor(
    private readonly root: () => string,
    private readonly version: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request<T>(method: string, path: string, opts: { body?: unknown; token?: string } = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.root() + path, {
        method,
        headers: {
          'User-Agent': `${USER_AGENT}/${this.version}`,
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new UserError('Не удалось связаться с сервером аккаунтов. Проверьте интернет и попробуйте ещё раз.');
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = undefined;
    }
    if (!res.ok) {
      if (res.status === 401) throw sessionExpired();
      const message = (data as { errorMessage?: string } | undefined)?.errorMessage;
      if (res.status === 429) throw new UserError(message ?? 'Слишком много попыток. Подождите немного.');
      throw new UserError(message ?? `Сервер аккаунтов ответил ошибкой ${res.status}.`);
    }
    return data as T;
  }

  authenticate(login: string, password: string, clientToken: string) {
    return this.request<AuthResponse>('POST', '/authserver/authenticate', {
      body: { username: login, password, clientToken, requestUser: false, agent: { name: 'Minecraft', version: 1 } },
    });
  }

  /** Returns null if the token can no longer be refreshed (log in again). */
  async refresh(accessToken: string, clientToken: string): Promise<AuthResponse | null> {
    try {
      return await this.request<AuthResponse>('POST', '/authserver/refresh', { body: { accessToken, clientToken } });
    } catch (err) {
      if (err instanceof UserError && /Invalid token/i.test(err.message)) return null;
      throw err;
    }
  }

  invalidate(accessToken: string, clientToken: string) {
    return this.request<void>('POST', '/authserver/invalidate', { body: { accessToken, clientToken } });
  }

  /** authlib-injector metadata (GET /), base64 for -Dauthlibinjector.yggdrasil.prefetched. */
  async metadataBase64(): Promise<string | undefined> {
    try {
      const res = await this.fetchImpl(this.root() + '/', { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) return undefined;
      return Buffer.from(await res.text(), 'utf8').toString('base64');
    } catch {
      return undefined;
    }
  }

  config() {
    return this.request<ServerConfig>('GET', '/launcher/config');
  }

  register(username: string, email: string, password: string) {
    return this.request<RegisterResult>('POST', '/launcher/register', { body: { username, email, password } });
  }

  resendVerification(login: string) {
    return this.request<void>('POST', '/launcher/resend-verification', { body: { login } });
  }

  forgotPassword(login: string) {
    return this.request<void>('POST', '/launcher/forgot-password', { body: { login } });
  }

  me(token: string) {
    return this.request<Me>('GET', '/launcher/me', { token });
  }

  changePassword(token: string, oldPassword: string, newPassword: string) {
    return this.request<void>('POST', '/launcher/change-password', { token, body: { oldPassword, newPassword } });
  }

  uploadSkin(token: string, png: string, model: 'classic' | 'slim') {
    return this.request<Me>('POST', '/launcher/skin', { token, body: { png, model } });
  }

  setSkinModel(token: string, model: 'classic' | 'slim') {
    return this.request<Me>('POST', '/launcher/skin', { token, body: { model } });
  }

  resetSkin(token: string) {
    return this.request<Me>('DELETE', '/launcher/skin', { token });
  }

  news() {
    return this.request<NewsItem[]>('GET', '/launcher/news');
  }
}
