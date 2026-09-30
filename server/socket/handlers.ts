import type { Server } from 'socket.io';
import { v4 } from 'uuid';

import { aiRequestSchema, aiUndoSchema } from '@/common/schemas/ai';
import {
  checkRoomSchema,
  createRoomSchema,
  cursorSchema,
  drawSchema,
  joinRoomSchema,
  rejoinRoomSchema,
  sendMsgSchema,
  strokeEndSchema,
  strokePointsSchema,
  strokeStartSchema,
  viewportSchema,
} from '@/common/schemas/events';
import type {
  ClientToServerEvents,
  Features,
  Identity,
  ServerToClientEvents,
} from '@/common/types/global';

import type { AiService } from '../ai';
import type { BoardStore } from '../boards/BoardStore';
import { logger } from '../logger';
import { toPublicUsers } from '../rooms/types';
import type { ObjectStorage } from '../storage';
import type { SocketData } from './identity';
import { withinLimit } from './rateLimit';
import { safeHandler } from './safeHandler';

/** The `error` half of a Zod `safeParse` result, narrowed to what is logged. */
type ParseFailure = { issues: { path: PropertyKey[]; message: string }[] };

/** Optional services the handlers can call into, and what to tell clients about them. */
export type HandlerDeps = {
  /** Null when the AI teammate is switched off; the AI handlers then drop everything. */
  ai: AiService | null;
  features: Features;
  /** Where inline image payloads are moved to, so moves carry URLs, not bytes. */
  storage: ObjectStorage | null;
  /** Folds a guest's record into the account it signed in with. */
  mergeGuest?: (guestId: string, accountId: string) => Promise<void>;
};

const DEFAULT_DEPS: HandlerDeps = {
  ai: null,
  features: { ai: false, rewind: true },
  storage: null,
};

const DATA_URL = /^data:(image\/[a-z+.-]+);base64,(.+)$/iu;

const EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * An image that arrived inline (an older client, or an upload that could not
 * be presigned) is written to storage and the move rewritten to its URL, so
 * what is stored and replayed is small. Left as it came if anything fails:
 * a large move beats a lost image.
 */
const offloadInlineImage = async (
  storage: ObjectStorage,
  roomId: string,
  move: { clientId: string; img: { base64?: string; url?: string } },
) => {
  const match = move.img.base64 ? DATA_URL.exec(move.img.base64) : null;

  if (!match) return;

  const [, contentType, data] = match;
  const key = `uploads/${roomId}/${move.clientId}.${EXTENSION[contentType] ?? 'bin'}`;

  try {
    await storage.put(key, Buffer.from(data, 'base64'), contentType);

    // eslint-disable-next-line no-param-reassign -- rewriting the payload in place is the purpose
    move.img = { url: storage.publicUrl(key) };
  } catch (error) {
    logger.warn({ err: error, roomId }, 'could not offload an inline image; keeping it inline');
  }
};

/**
 * Registers every socket event. Each handler is wrapped by `safeHandler`,
 * returns early when the socket is not in a room, and validates its payload
 * before touching room state.
 *
 * Invalid payloads are dropped rather than answered with an error, with two
 * deliberate exceptions: `check_room` and `join_room` are questions the client
 * is waiting on, so a malformed id gets the negative answer instead of
 * silence. Dropping those would leave the client on a spinner forever.
 */
export const registerSocketHandlers = (
  io: Server<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >,
  rooms: BoardStore,
  deps: HandlerDeps = DEFAULT_DEPS,
) => {
  io.on('connection', (socket) => {
    // Stable across reconnects, unlike socket.id. Guaranteed by the handshake
    // middleware, which refuses connections without one.
    const { userId } = socket.data;

    // First thing a client learns: which optional features exist here. The
    // UI for a feature renders only after this says so.
    socket.emit('features', deps.features);

    const identity: Identity = socket.data.account ?? {
      userId,
      isGuest: true,
      name: null,
      email: null,
      image: null,
    };

    // A guest who just signed in: everything the guest id had becomes the
    // account's, in the record and in the rooms loaded right now, before the
    // client is told which id it is.
    const claimed = socket.data.claimedGuestId;

    if (claimed && deps.mergeGuest) {
      deps
        .mergeGuest(claimed, userId)
        .then(() => rooms.rooms.reattribute(claimed, userId))
        .catch((error) => {
          logger.error({ err: error, claimed, userId }, 'guest merge failed');
        })
        .finally(() => socket.emit('identity', identity));
    } else {
      socket.emit('identity', identity);
    }

    const throttled = (event: string) => {
      // Debug, not warn: hitting a limit is the system working as intended,
      // and a noisy client would otherwise fill the log with it.
      logger.debug({ event, socketId: socket.id }, 'rate limit exceeded');
    };

    const dropped = (event: string, error: ParseFailure) => {
      logger.warn(
        {
          event,
          socketId: socket.id,
          issues: error.issues.map(({ path, message }) => ({
            path: path.join('.'),
            message,
          })),
        },
        'dropped invalid payload',
      );
    };

    /**
     * The room this socket has joined, or undefined when it has joined none.
     * Socket.IO puts every socket in a room named after its own id, which is
     * the one being filtered out here.
     */
    const getRoomId = () => [...socket.rooms].find((room) => room !== socket.id);

    const leaveRoom = (roomId: string) => {
      if (!rooms.leave(roomId, userId)) return;

      socket.leave(roomId);
    };

    socket.on(
      'create_room',
      safeHandler('create_room', async (username) => {
        if (!(await withinLimit('room_entry', userId))) {
          throttled('create_room');
          return;
        }

        const parsed = createRoomSchema.safeParse(username);

        if (!parsed.success) {
          dropped('create_room', parsed.error);
          return;
        }

        // parsed.data is the sanitized name: trimmed, control characters gone.
        const { roomId } = await rooms.create(userId, parsed.data, socket.id);

        socket.join(roomId);

        io.to(socket.id).emit('created', roomId);
      }),
    );

    socket.on(
      'check_room',
      safeHandler('check_room', async (roomId) => {
        const parsed = checkRoomSchema.safeParse(roomId);

        // An id that cannot exist does not exist. Answering keeps the client
        // moving instead of waiting on a reply that never comes. A room that
        // is not in memory may still be on disk, so ask the store to load it.
        const exists = parsed.success && (await rooms.ensureLoaded(parsed.data));

        socket.emit('room_exists', exists);
      }),
    );

    socket.on(
      'join_room',
      safeHandler('join_room', async (roomId, username) => {
        if (!(await withinLimit('room_entry', userId))) {
          throttled('join_room');
          return;
        }

        const parsed = joinRoomSchema.safeParse({ roomId, username });

        if (!parsed.success) {
          dropped('join_room', parsed.error);

          // Echo back what the client asked for, so its modal can name the
          // room even when the request was malformed.
          io.to(socket.id).emit(
            'joined',
            typeof roomId === 'string' ? roomId : '',
            true,
          );
          return;
        }

        await rooms.ensureLoaded(parsed.data.roomId);

        if (
          rooms.join(
            parsed.data.roomId,
            userId,
            parsed.data.username,
            socket.id,
          )
        ) {
          socket.join(parsed.data.roomId);

          io.to(socket.id).emit('joined', parsed.data.roomId);
        } else {
          io.to(socket.id).emit('joined', parsed.data.roomId, true);
        }
      }),
    );

    socket.on(
      'joined_room',
      safeHandler('joined_room', () => {
        const roomId = getRoomId();
        if (!roomId) return;

        const room = rooms.get(roomId);
        if (!room) return;

        io.to(socket.id).emit(
          'room',
          room,
          JSON.stringify([...room.usersMoves]),
          JSON.stringify(toPublicUsers(room.users)),
        );

        const me = room.users.get(userId);
        if (!me) return;

        socket.broadcast.to(roomId).emit('new_user', userId, me.name, me.color);
      }),
    );

    socket.on(
      'rejoin_room',
      safeHandler('rejoin_room', async (roomId, lastSeq) => {
        const parsed = rejoinRoomSchema.safeParse({ roomId, lastSeq });

        if (!parsed.success) {
          dropped('rejoin_room', parsed.error);
          // Fall back to the name gate rather than leaving the client waiting.
          io.to(socket.id).emit('joined', '', true);
          return;
        }

        await rooms.ensureLoaded(parsed.data.roomId);

        const room = rooms.get(parsed.data.roomId);
        const existing = room?.users.get(userId);

        // No room, or the grace window already expired and the place was
        // given up. Either way there is no session to resume.
        if (!room || !existing) {
          io.to(socket.id).emit('joined', '', true);
          return;
        }

        rooms.join(parsed.data.roomId, userId, existing.name, socket.id);
        socket.join(parsed.data.roomId);

        const delta = rooms.deltaSince(parsed.data.roomId, parsed.data.lastSeq);

        io.to(socket.id).emit(
          'room_delta',
          JSON.stringify(delta.usersMoves),
          JSON.stringify(delta.drawed),
          JSON.stringify(toPublicUsers(room.users)),
        );

        socket.broadcast.to(parsed.data.roomId).emit('user_online', userId);
      }),
    );

    socket.on(
      'leave_room',
      safeHandler('leave_room', () => {
        const roomId = getRoomId();
        if (!roomId) return;

        leaveRoom(roomId);

        io.to(roomId).emit('user_disconnected', userId);
      }),
    );

    socket.on(
      'draw',
      safeHandler('draw', async (move) => {
        const roomId = getRoomId();
        if (!roomId) return;

        if (!(await withinLimit('draw', userId))) {
          throttled('draw');
          return;
        }

        const parsed = drawSchema.safeParse(move);

        if (!parsed.success) {
          dropped('draw', parsed.error);
          return;
        }

        if (deps.storage && parsed.data.options.shape === 'image') {
          await offloadInlineImage(deps.storage, roomId, parsed.data);
        }

        // The store stamps id, timestamp and seq: ordering and identity are
        // the server's to decide, which is why the payload schema omits them.
        const result = rooms.addMove(roomId, userId, parsed.data);

        if (result.status === 'duplicate') {
          // A resend of something already drawn. Echo it back so a client that
          // retried because it never saw the first reply still converges.
          logger.debug(
            { clientId: parsed.data.clientId, userId },
            'ignored a duplicate move',
          );
          return;
        }

        // Only announce a move the server actually kept.
        if (result.status !== 'stored') return;

        io.to(socket.id).emit('your_move', result.move);
        socket.broadcast.to(roomId).emit('user_draw', result.move, userId);
      }),
    );

    socket.on(
      'stroke_start',
      safeHandler('stroke_start', async (strokeId, options, from) => {
        const roomId = getRoomId();
        if (!roomId) return;

        if (!(await withinLimit('stroke_points', userId))) return;

        const parsed = strokeStartSchema.safeParse({ strokeId, options, from });
        if (!parsed.success) return;

        socket.broadcast
          .to(roomId)
          .volatile.emit(
            'live_stroke_start',
            userId,
            parsed.data.strokeId,
            parsed.data.options,
            parsed.data.from,
          );
      }),
    );

    socket.on(
      'stroke_points',
      safeHandler('stroke_points', async (strokeId, points) => {
        const roomId = getRoomId();
        if (!roomId) return;

        // Deliberately quiet: this arrives up to 60 times a second, and a
        // warn per throttled or malformed batch would drown the log.
        if (!(await withinLimit('stroke_points', userId))) return;

        const parsed = strokePointsSchema.safeParse({ strokeId, points });
        if (!parsed.success) return;

        socket.broadcast
          .to(roomId)
          .volatile.emit(
            'live_stroke_points',
            userId,
            parsed.data.strokeId,
            parsed.data.points,
          );
      }),
    );

    socket.on(
      'stroke_end',
      safeHandler('stroke_end', (strokeId) => {
        const roomId = getRoomId();
        if (!roomId) return;

        const parsed = strokeEndSchema.safeParse({ strokeId });
        if (!parsed.success) return;

        socket.broadcast
          .to(roomId)
          .volatile.emit('live_stroke_end', userId, parsed.data.strokeId);
      }),
    );

    socket.on(
      'undo',
      safeHandler('undo', () => {
        const roomId = getRoomId();
        if (!roomId) return;

        if (!rooms.undoMove(roomId, userId)) return;

        socket.broadcast.to(roomId).emit('user_undo', userId);
      }),
    );

    socket.on(
      'cursor',
      safeHandler('cursor', async (x, y) => {
        const roomId = getRoomId();
        if (!roomId) return;

        if (!(await withinLimit('cursor', userId))) return;

        const parsed = cursorSchema.safeParse({ x, y });

        // Deliberately quiet: this arrives many times a second, and a warn
        // per bad packet would drown the log.
        if (!parsed.success) return;

        socket.broadcast
          .to(roomId)
          .volatile.emit('cursor_moved', userId, parsed.data.x, parsed.data.y);
      }),
    );

    socket.on(
      'viewport',
      safeHandler('viewport', async (x, y, scale) => {
        const roomId = getRoomId();
        if (!roomId) return;

        if (!(await withinLimit('viewport', userId))) return;

        const parsed = viewportSchema.safeParse({ x, y, scale });
        if (!parsed.success) return;

        socket.broadcast
          .to(roomId)
          .volatile.emit(
            'viewport_changed',
            userId,
            parsed.data.x,
            parsed.data.y,
            parsed.data.scale,
          );
      }),
    );

    socket.on(
      'summon',
      safeHandler('summon', async () => {
        const roomId = getRoomId();
        if (!roomId) return;

        if (!(await withinLimit('summon', userId))) {
          throttled('summon');
          return;
        }

        socket.broadcast.to(roomId).emit('summoned', userId);
      }),
    );

    socket.on(
      'send_msg',
      safeHandler('send_msg', async (msg) => {
        const roomId = getRoomId();
        if (!roomId) return;

        if (!(await withinLimit('send_msg', userId))) {
          throttled('send_msg');
          // The only limit the sender is told about: they typed something and
          // pressed send, so silence would read as a broken app.
          socket.emit('rate_limited', 'send_msg');
          return;
        }

        const parsed = sendMsgSchema.safeParse(msg);

        if (!parsed.success) {
          dropped('send_msg', parsed.error);
          return;
        }

        io.to(roomId).emit('new_msg', userId, parsed.data);

        const author = rooms.get(roomId)?.users.get(userId)?.name ?? 'Someone';

        // Kept for late joiners (and for durability, when configured).
        rooms.appendChat(roomId, {
          id: v4(),
          userId,
          name: author,
          body: parsed.data,
          createdAt: Date.now(),
        });

        deps.ai?.noteChat(roomId, author, parsed.data);
      }),
    );

    socket.on(
      'ai_request',
      safeHandler('ai_request', async (request) => {
        const roomId = getRoomId();
        if (!roomId) return;

        // With AI off, the event is dropped like any unknown one: no code
        // under server/ai runs, and the client never offered the button.
        if (!deps.ai) {
          logger.debug({ userId }, 'ignored ai_request: AI disabled');
          return;
        }

        if (!(await withinLimit('ai_request', userId))) {
          throttled('ai_request');
          socket.emit('rate_limited', 'ai_request');
          return;
        }

        const parsed = aiRequestSchema.safeParse(request);

        if (!parsed.success) {
          dropped('ai_request', parsed.error);
          return;
        }

        await deps.ai.request({ roomId, userId }, parsed.data);
      }),
    );

    socket.on(
      'ai_undo',
      safeHandler('ai_undo', (requestId) => {
        const roomId = getRoomId();
        if (!roomId || !deps.ai) return;

        const parsed = aiUndoSchema.safeParse(requestId);

        if (!parsed.success) {
          dropped('ai_undo', parsed.error);
          return;
        }

        deps.ai.undo(roomId, userId, parsed.data);
      }),
    );

    socket.on(
      'disconnecting',
      safeHandler('disconnecting', () => {
        const roomId = getRoomId();
        if (!roomId) return;

        // A dropped socket is not the same as leaving. The place is held for
        // the grace window, and `user_disconnected` is broadcast only once it
        // expires — see the finalize callback wired up in `app.ts`.
        if (rooms.markOffline(roomId, userId)) {
          socket.broadcast.to(roomId).emit('user_offline', userId);
          return;
        }

        leaveRoom(roomId);

        io.to(roomId).emit('user_disconnected', userId);
      }),
    );
  });
};
