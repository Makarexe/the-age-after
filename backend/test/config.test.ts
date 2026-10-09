import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = { DATABASE_URL: 'postgres://x', PUBLIC_URL: 'https://auth.example.test/' };

describe('loadConfig', () => {
  it('applies defaults and treats empty variables as unset', () => {
    const c = loadConfig({ ...base, SMTP_HOST: '', SMTP_PORT: '', PACK_MANIFEST_URL: '', SIGNING_PRIVATE_KEY: '' });
    expect(c.publicUrl).toBe('https://auth.example.test');
    expect(c.smtp).toBeUndefined();
    expect(c.signingPrivateKey).toBeUndefined();
    expect(c.packManifestUrl).toContain('/releases/download/pack-latest/manifest.json');
    expect(c.port).toBe(3000);
    expect(c.serverAddress).toBe('185.9.145.108:32796');
    expect(c.figuraServer).toBe('');
  });

  it('keeps only the host of FIGURA_SERVER, as Figura expects', () => {
    expect(loadConfig({ ...base, FIGURA_SERVER: ' https://figura-production.up.railway.app/ ' }).figuraServer).toBe(
      'figura-production.up.railway.app',
    );
    expect(loadConfig({ ...base, FIGURA_SERVER: 'figura.example.test:8443' }).figuraServer).toBe('figura.example.test:8443');
  });

  it('builds SMTP settings', () => {
    const c = loadConfig({ ...base, SMTP_HOST: 'smtp.yandex.ru', SMTP_SECURE: 'true', SMTP_USER: 'me@yandex.ru', SMTP_PASS: 'x' });
    expect(c.smtp).toEqual({ host: 'smtp.yandex.ru', port: 465, secure: true, user: 'me@yandex.ru', pass: 'x', from: 'me@yandex.ru' });
  });

  it('unescapes \\n in a pasted key', () => {
    const c = loadConfig({ ...base, SIGNING_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----' });
    expect(c.signingPrivateKey).toBe('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----');
  });

  it('fails clearly without required variables', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
});
