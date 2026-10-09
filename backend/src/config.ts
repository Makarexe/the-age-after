import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  PUBLIC_URL: z.url(),
  SIGNING_PRIVATE_KEY: z.string().optional(),
  SERVER_NAME: z.string().default('The Age After'),
  SERVER_ADDRESS: z.string().default(''),
  PACK_MANIFEST_URL: z
    .string()
    .default('https://github.com/makarexe/the-age-after/releases/download/pack-latest/manifest.json'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_SECURE: bool,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  ADMIN_NOTIFY_EMAIL: z.string().optional(),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
  NODE_ENV: z.string().default('development'),
});

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  /** API root without trailing slash, e.g. https://app.up.railway.app */
  publicUrl: string;
  signingPrivateKey?: string;
  serverName: string;
  serverAddress: string;
  packManifestUrl: string;
  smtp?: SmtpConfig;
  adminNotifyEmail?: string;
  trustProxyHops: number;
  production: boolean;
}

/** Railway stores multi-line values fine, but pasted keys sometimes arrive with literal "\n". */
export function normalizePem(pem: string): string {
  return pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // An empty variable (e.g. `SMTP_PORT=` in Railway) means "not set".
  const parsed = envSchema.safeParse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== '')));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  const e = parsed.data;
  const smtp: SmtpConfig | undefined = e.SMTP_HOST
    ? {
        host: e.SMTP_HOST,
        port: e.SMTP_PORT ?? (e.SMTP_SECURE ? 465 : 587),
        secure: e.SMTP_SECURE,
        user: e.SMTP_USER,
        pass: e.SMTP_PASS,
        from: e.MAIL_FROM ?? e.SMTP_USER ?? 'noreply@localhost',
      }
    : undefined;
  return {
    port: e.PORT,
    host: e.HOST,
    databaseUrl: e.DATABASE_URL,
    publicUrl: e.PUBLIC_URL.replace(/\/+$/, ''),
    signingPrivateKey: e.SIGNING_PRIVATE_KEY ? normalizePem(e.SIGNING_PRIVATE_KEY) : undefined,
    serverName: e.SERVER_NAME,
    serverAddress: e.SERVER_ADDRESS,
    packManifestUrl: e.PACK_MANIFEST_URL,
    smtp,
    adminNotifyEmail: e.ADMIN_NOTIFY_EMAIL || undefined,
    trustProxyHops: e.TRUST_PROXY_HOPS,
    production: e.NODE_ENV === 'production',
  };
}
