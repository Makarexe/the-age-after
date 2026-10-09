import type { Config } from './config.js';
import type { DB } from './db/index.js';
import type { Mailer } from './lib/mailer.js';
import type { Signer } from './lib/signing.js';
import type { JoinStore } from './services/joins.js';

export interface AppContext {
  config: Config;
  db: DB;
  signer: Signer;
  mailer: Mailer;
  joins: JoinStore;
}
