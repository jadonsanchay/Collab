import { createServer } from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import { hostname } from 'os';
import { createAdapter } from '@socket.io/redis-adapter';
import { and, eq } from 'drizzle-orm';
import express from 'express';
import { Server } from 'socket.io';

import type {
  ClientToServerEvents,
  Features,
  ServerToClientEvents,
} from '@/common/types/global';

import { createAiService, type AiServiceOptions } from './ai';
import { buildAuthConfig } from './auth/authConfig';
import { DEV_GUEST_SECRET } from './auth/guestCookie';
import { mergeGuest } from './auth/mergeGuest';
import { DbRoleResolver } from './auth/dbRoles';
import { MemoryRoleResolver } from './auth/roles';
import { registerAuthRoutes } from './auth/routes';
import { resolveSession } from './auth/session';
import { BoardStore } from './boards/BoardStore';
import type { Persistence } from './boards/persistence';
import { registerBoardRoutes } from './boards/routes';
import { loadConfig, type Config } from './config';
import type { Database } from './db/client';
import { users } from './db/schema';
import { SnapshotService, type SnapshotOptions } from './jobs/snapshots';
import type { RedisClients } from './redis';
import { RoomStore } from './rooms/RoomStore';
import { registerSocketHandlers } from './socket/handlers';
import { registerIdentity, type SocketData } from './socket/identity';
import { resetRateLimits, enableRedisRateLimits } from './socket/rateLimit';
import { createStorage, type ObjectStorage } from './storage';
import { registerUploadRoutes } from './storage/routes';

/**
 * Shape of `nextApp.getRequestHandler()`. Declared structurally so tests can
 * pass a stub instead of booting Next.js, which is the whole reason this
 * factory lives apart from `index.ts`.
 */
export type NextRequestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => void | Promise<void>;

/**
 * Builds the Express app, the HTTP server, and the Socket.IO server, and wires
 * the socket handlers to a fresh `RoomStore`. Does not listen — the caller
 * decides the port, so tests can use an ephemeral one.
 */
export const createAppServer = ({
  nextHandler,
  config = loadConfig(),
  aiOptions = {},
  persistence = null,
  database = null,
  storage = createStorage(config),
  snapshotOptions = {},
  redis = null,
}: {
  nextHandler: NextRequestHandler;
  /** Overridable so tests can use grace windows measured in milliseconds. */
  config?: Config;
  /** Overridable so tests can inject an agent and shrink limits and timings. */
  aiOptions?: AiServiceOptions;
  /** The durability layer, or null for memory-only rooms. */
  persistence?: Persistence | null;
  /** The database behind `persistence`, for jobs that write their own rows. */
  database?: Database | null;
  /** Where images, snapshots and thumbnails go. Local filesystem by default. */
  storage?: ObjectStorage;
  snapshotOptions?: Partial<SnapshotOptions>;
  /** Connected Redis clients, or null for a single node with in-memory limits. */
  redis?: RedisClients | null;
}) => {
  const app = express();
  const server = createServer(app);

  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >(server, {
    /**
     * Explicit rather than left to the 1 MB default, and sized against the
     * 1.5 MB base64 image cap in the move schema plus room for the rest of
     * the payload. A frame larger than this is refused by Socket.IO before a
     * handler ever sees it.
     */
    maxHttpBufferSize: 2 * 1024 * 1024,
  });

  if (redis) {
    // Broadcasts fan out to every node's sockets; budgets count once for all.
    io.adapter(createAdapter(redis.pub, redis.sub));
    enableRedisRateLimits(redis.client);
  } else {
    resetRateLimits();
  }

  const rooms = new RoomStore({
    userGraceMs: config.USER_GRACE_MS,
    roomGraceMs: config.ROOM_GRACE_MS,
    sweepIntervalMs: config.SWEEP_INTERVAL_MS,
    /**
     * The store holds a disconnected user's place until their grace window
     * expires. This is the point at which they are gone for good, so this is
     * where the room is finally told.
     */
    onUserFinalized: (roomId, userId) => {
      io.to(roomId).emit('user_disconnected', userId);
    },
  });

  // Snapshots and thumbnails need somewhere to record themselves, so they
  // exist only alongside a database. Assigned after the store, which calls
  // back into them on every change.
  let snapshots: SnapshotService | null = null;

  // The in-memory store is the source of truth for live rooms; the board
  // store adds durability on top when a persistence layer is configured.
  const boards = new BoardStore(rooms, persistence, {
    onActivity: (roomId) => snapshots?.noteActivity(roomId),
  });

  if (database) snapshots = new SnapshotService(boards, database, storage, snapshotOptions);

  // Null unless AI_ENABLED and an agent is available. With it null, no code
  // under server/ai runs and the client is told the feature does not exist.
  const ai = createAiService({ io, boards, config, options: aiOptions });

  // Sign-in exists only with a database to keep accounts in and a secret to
  // sign sessions with. Guests need neither.
  const authConfig = database ? buildAuthConfig(config, database.db) : null;
  const guestSecret = config.AUTH_SECRET ?? DEV_GUEST_SECRET;

  const features: Features = {
    ai: ai !== null,
    rewind: config.REWIND_ENABLED,
    auth: authConfig !== null,
    persistent: boards.persistent,
    // Only meaningful once there is more than one node to tell apart.
    ...(redis ? { node: config.NODE_ID ?? hostname() } : {}),
  };

  // Order matters: identity runs as middleware, so every handler can rely on
  // socket.data.userId being present and valid.
  registerIdentity(io, {
    resolveSession: authConfig
      ? (cookieHeader) => resolveSession(cookieHeader, config.AUTH_SECRET as string)
      : undefined,
    isAccountId: database
      ? async (userId) => {
          const [row] = await database.db
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.id, userId), eq(users.isGuest, false)));

          return Boolean(row);
        }
      : undefined,
  });
  // With a database, memberships and visibility decide what a user may do;
  // without one, the memory rule from before Phase 3.
  const roles = database ? new DbRoleResolver(database.db, boards) : new MemoryRoleResolver(boards);

  registerSocketHandlers(io, boards, {
    ai,
    features,
    storage,
    roles,
    mergeGuest: database ? (guestId, accountId) => mergeGuest(database.db, guestId, accountId) : undefined,
  });

  app.get('/hello', async (_, res) => {
    res.send('Hello World');
  });

  registerUploadRoutes(app, { storage, config });

  const authDeps = { config, authConfig, db: database?.db ?? null, guestSecret };
  registerAuthRoutes(app, authDeps);

  if (database) registerBoardRoutes(app, { db: database.db, boards, roles, auth: authDeps });

  // Everything else (pages, assets, API routes) falls through to Next.js.
  app.all('*', (req, res) => nextHandler(req, res));

  return {
    app,
    server,
    io,
    rooms,
    boards,
    config,
    ai,
    features,
    redis,
    storage,
    snapshots,
    authConfig,
    roles,
  };
};
