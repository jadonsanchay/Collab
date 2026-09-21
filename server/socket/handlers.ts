import type { Server } from 'socket.io';

import {
  checkRoomSchema,
  createRoomSchema,
  drawSchema,
  joinRoomSchema,
  mouseMoveSchema,
  sendMsgSchema,
} from '@/common/schemas/events';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@/common/types/global';

import { logger } from '../logger';
import type { RoomStore } from '../rooms/RoomStore';
import type { SocketData } from './identity';
import { withinLimit } from './rateLimit';
import { safeHandler } from './safeHandler';

/** The `error` half of a Zod `safeParse` result, narrowed to what is logged. */
type ParseFailure = { issues: { path: PropertyKey[]; message: string }[] };

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
  rooms: RoomStore,
) => {
  io.on('connection', (socket) => {
    // Stable across reconnects, unlike socket.id. Guaranteed by the handshake
    // middleware, which refuses connections without one.
    const { userId } = socket.data;

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
        const { roomId } = rooms.create(userId, parsed.data);

        socket.join(roomId);

        io.to(socket.id).emit('created', roomId);
      }),
    );

    socket.on(
      'check_room',
      safeHandler('check_room', (roomId) => {
        const parsed = checkRoomSchema.safeParse(roomId);

        // An id that cannot exist does not exist. Answering keeps the client
        // moving instead of waiting on a reply that never comes.
        socket.emit('room_exists', parsed.success && rooms.has(parsed.data));
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

        if (rooms.join(parsed.data.roomId, userId, parsed.data.username)) {
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
          JSON.stringify([...room.users]),
        );

        const me = room.users.get(userId);
        if (!me) return;

        socket.broadcast.to(roomId).emit('new_user', userId, me.name, me.color);
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
      'undo',
      safeHandler('undo', () => {
        const roomId = getRoomId();
        if (!roomId) return;

        if (!rooms.undoMove(roomId, userId)) return;

        socket.broadcast.to(roomId).emit('user_undo', userId);
      }),
    );

    socket.on(
      'mouse_move',
      safeHandler('mouse_move', async (x, y) => {
        const roomId = getRoomId();
        if (!roomId) return;

        if (!(await withinLimit('mouse_move', userId))) return;

        const parsed = mouseMoveSchema.safeParse({ x, y });

        // Deliberately quiet: cursor updates arrive many times a second, and a
        // warn per bad packet would drown the log.
        if (!parsed.success) return;

        socket.broadcast
          .to(roomId)
          .emit('mouse_moved', parsed.data.x, parsed.data.y, userId);
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
      }),
    );

    socket.on(
      'disconnecting',
      safeHandler('disconnecting', () => {
        const roomId = getRoomId();
        if (!roomId) return;

        leaveRoom(roomId);

        io.to(roomId).emit('user_disconnected', userId);
      }),
    );
  });
};
