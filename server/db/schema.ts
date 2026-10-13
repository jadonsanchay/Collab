import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';


import type { ChatMessage, Move } from '@/common/types/global';

/** Postgres `bytea` as a Buffer; Drizzle has no built-in for it. */
const customBytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (value) => value,
  fromDriver: (value) => (Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array)),
});

/**
 * The persistent model. Boards, their current moves, an append-only op log
 * for history, chat, members, share links, snapshots, and the Auth.js
 * tables. Ids are text: room ids are 8 base64url characters, everything
 * else a uuid string, so no column needs a Postgres-specific type.
 */

const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  /** Null for guests. */
  email: text('email').unique(),
  name: text('name'),
  /** Unique handle for password sign-in; null for guests and OAuth-only accounts. */
  username: text('username').unique(),
  /** scrypt hash from `server/auth/password.ts`; null when the account has no password. */
  passwordHash: text('password_hash'),
  image: text('image'),
  emailVerified: timestamp('email_verified', { withTimezone: true, mode: 'date' }),
  isGuest: boolean('is_guest').notNull().default(true),
  createdAt: createdAt(),
});

/* Auth.js adapter tables, in the shape @auth/drizzle-adapter expects. */

export const accounts = pgTable(
  'accounts',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (table) => [primaryKey({ columns: [table.provider, table.providerAccountId] })],
);

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { withTimezone: true, mode: 'date' }).notNull(),
});

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);

/* Boards */

export const boards = pgTable(
  'boards',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    ownerId: text('owner_id').references(() => users.id, { onDelete: 'set null' }),
    /** 'private' needs membership; 'link' lets anyone with the id in as `linkRole`. */
    visibility: text('visibility').notNull().default('link'),
    /** The role a non-member gets on a 'link' board. */
    linkRole: text('link_role').notNull().default('editor'),
    engine: text('engine').notNull().default('raster'),
    settings: jsonb('settings').notNull().default({}),
    thumbnailKey: text('thumbnail_key'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [index('boards_owner_idx').on(table.ownerId, table.lastActivityAt)],
);

export const boardMembers = pgTable(
  'board_members',
  {
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.boardId, table.userId] }),
    index('board_members_user_idx').on(table.userId),
  ],
);

export const boardStars = pgTable(
  'board_stars',
  {
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.boardId, table.userId] })],
);

/** The board as it is now: one row per surviving move. Loading a room reads this. */
export const boardMoves = pgTable(
  'board_moves',
  {
    moveId: text('move_id').primaryKey(),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    userId: text('user_id').notNull(),
    clientId: text('client_id').notNull(),
    payload: jsonb('payload').$type<Move>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('board_moves_board_seq_idx').on(table.boardId, table.seq)],
);

/**
 * Append-only history: every move, undo and removal in order. Rewind and
 * audits fold this; the live state is `board_moves`.
 */
export const boardOps = pgTable(
  'board_ops',
  {
    id: text('id').primaryKey(),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    /** The move's sequence for `move` ops; null for undo and remove. */
    seq: bigint('seq', { mode: 'number' }),
    kind: text('kind').notNull(),
    moveId: text('move_id').notNull(),
    userId: text('user_id'),
    payload: jsonb('payload').$type<Move | null>(),
    createdAt: createdAt(),
  },
  (table) => [index('board_ops_board_created_idx').on(table.boardId, table.createdAt)],
);

export const boardSnapshots = pgTable(
  'board_snapshots',
  {
    id: text('id').primaryKey(),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    imageKey: text('image_key').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('board_snapshots_board_seq_idx').on(table.boardId, table.seq)],
);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: text('id').primaryKey(),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('chat_messages_board_created_idx').on(table.boardId, table.createdAt)],
);

export const shareLinks = pgTable('share_links', {
  token: text('token').primaryKey(),
  boardId: text('board_id')
    .notNull()
    .references(() => boards.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
  createdBy: text('created_by'),
  createdAt: createdAt(),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
});

/** The current Yjs document of a vector board, encoded, written on debounce. */
export const boardDocs = pgTable('board_docs', {
  boardId: text('board_id')
    .primaryKey()
    .references(() => boards.id, { onDelete: 'cascade' }),
  state: customBytea('state').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

/** Every update applied to a vector board, in order: Rewind for vector boards folds this. */
export const boardDocUpdates = pgTable(
  'board_doc_updates',
  {
    id: text('id').primaryKey(),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    userId: text('user_id'),
    update: customBytea('update').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('board_doc_updates_board_seq_idx').on(table.boardId, table.seq)],
);

export const aiJobs = pgTable('ai_jobs', {
  id: text('id').primaryKey(),
  boardId: text('board_id').notNull(),
  userId: text('user_id').notNull(),
  kind: text('kind').notNull(),
  status: text('status').notNull(),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  cacheReadTokens: integer('cache_read_tokens'),
  durationMs: integer('duration_ms'),
  createdAt: createdAt(),
});

export type ChatMessageRow = typeof chatMessages.$inferSelect;

/** Row → wire shape, in one place so the two never drift. */
export const toChatMessage = (row: ChatMessageRow): ChatMessage => ({
  id: row.id,
  userId: row.userId,
  name: row.name,
  body: row.body,
  createdAt: row.createdAt.getTime(),
});
