import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType() {
    return 'bytea';
  },
  fromDriver(value) {
    return Buffer.isBuffer(value) ? value : Buffer.from(value);
  },
});

export const userStatus = pgEnum('user_status', [
  'pending_email',
  'pending_approval',
  'active',
  'rejected',
  'banned',
]);
export type UserStatus = (typeof userStatus.enumValues)[number];

export const skinModel = pgEnum('skin_model', ['classic', 'slim']);
export type SkinModel = (typeof skinModel.enumValues)[number];

export const emailTokenPurpose = pgEnum('email_token_purpose', ['verify', 'reset']);
export type EmailTokenPurpose = (typeof emailTokenPurpose.enumValues)[number];

export const skins = pgTable('skins', {
  sha256: text('sha256').primaryKey(),
  png: bytea('png').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  'users',
  {
    /** Offline UUID of the nickname; also the Minecraft profile id. */
    id: uuid('id').primaryKey(),
    username: text('username').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    status: userStatus('status').notNull(),
    isAdmin: boolean('is_admin').notNull().default(false),
    skinSha256: text('skin_sha256').references(() => skins.sha256, { onDelete: 'set null' }),
    skinModel: skinModel('skin_model').notNull().default('classic'),
    statusReason: text('status_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('users_username_lower_idx').on(sql`lower(${t.username})`),
    uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`),
    index('users_status_idx').on(t.status),
  ],
);

export const accessTokens = pgTable(
  'access_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    clientToken: text('client_token').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('access_tokens_user_idx').on(t.userId)],
);

export const emailTokens = pgTable(
  'email_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: emailTokenPurpose('purpose').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('email_tokens_user_idx').on(t.userId, t.purpose)],
);

export const news = pgTable('news', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable(
  'audit_log',
  {
    id: serial('id').primaryKey(),
    adminId: uuid('admin_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'set null' }),
    details: jsonb('details'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_created_idx').on(t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type NewsItem = typeof news.$inferSelect;


/** Server-generated secrets that must survive restarts (e.g. the texture signing key). */
export const appSecrets = pgTable('app_secrets', {
  name: text('name').primaryKey(),
  value: text('value').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
