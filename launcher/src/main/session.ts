import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Profile } from '../shared/types';

/** Electron's safeStorage (DPAPI on Windows), injectable for tests. */
export interface SecretBox {
  available(): boolean;
  encrypt(plain: string): string;
  decrypt(sealed: string): string;
}

interface Stored {
  clientToken: string;
  accessToken?: string;
  profile?: Profile;
}

/** Keeps the access token encrypted on disk. The password is never stored. */
export class SessionStore {
  private data: Stored;

  constructor(
    private readonly file: string,
    private readonly box: SecretBox,
  ) {
    try {
      this.data = JSON.parse(readFileSync(file, 'utf8'));
      if (!this.data.clientToken) throw new Error('no client token');
    } catch {
      this.data = { clientToken: randomUUID().replace(/-/g, '') };
    }
  }

  get clientToken(): string {
    return this.data.clientToken;
  }

  get profile(): Profile | null {
    return this.accessToken ? (this.data.profile ?? null) : null;
  }

  get accessToken(): string | null {
    if (!this.data.accessToken || !this.box.available()) return null;
    try {
      return this.box.decrypt(this.data.accessToken);
    } catch {
      return null;
    }
  }

  set(accessToken: string, profile: Profile): void {
    if (!this.box.available()) throw new Error('Шифрование недоступно: не могу безопасно сохранить вход.');
    this.data = { clientToken: this.data.clientToken, accessToken: this.box.encrypt(accessToken), profile };
    this.save();
  }

  clear(): void {
    this.data = { clientToken: this.data.clientToken };
    this.save();
  }

  private save(): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.data));
  }

  static remove(file: string): void {
    rmSync(file, { force: true });
  }
}
