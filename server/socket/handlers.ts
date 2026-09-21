import type { Server } from 'socket.io';
import { v4 } from 'uuid';

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
import { forgetSocket, withinLimit } from './rateLimit';
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
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  rooms: RoomStore,
) => {
  io.on('connection', (socket) => {
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
      if (!rooms.leave(roomId, socket.id)) return;

      socket.leave(roomId);
    };

    socket.on(
      'create_room',
      safeHandler('create_room', async (username) => {
        if (!(await withinLimit('room_entry', socket.id))) {
          throttled('create_room');
          return;
        }

        const parsed = createRoomSchema.safeParse(username);

        if (!parsed.success) {
          dropped('create_room', parsed.error);
          return;
        }

        // parsed.data is the sanitized name: trimmed, control characters gone.
        const roomId = rooms.create(socket.id, parsed.data);

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
        if (!(await withinLimit('room_entry', socket.id))) {
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

        if (rooms.join(parsed.data.roomId, socket.id, parsed.data.username)) {
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

        socket.broadcast
          .to(roomId)
          .emit('new_user', socket.id, room.users.get(socket.id) || 'Anonymous');
      }),
    );

    socket.on(
      'leave_room',
      safeHandler('leave_room', () => {
        const roomId = getRoomId();
        if (!roomId) return;

        leaveRoom(roomId);

        io.to(roomId).emit('user_disconnected', socket.id);
      }),
    );

    socket.on(
      'draw',
      safeHandler('draw', async (move) => {
        const roomId = getRoomId();
        if (!roomId) return;

        if (!(await withinLimit('draw', socket.id))) {
          throttled('draw');
          return;
        }

        const parsed = drawSchema.safeParse(move);

        if (!parsed.success) {
          dropped('draw', parsed.error);
          return;
        }

        // The server owns identity and ordering, which is why the payload
        // schema omits both fields.
        const finalizedMove = {
          ...parsed.data,
          id: v4(),
          timestamp: Date.now(),
        };

        // Only announce a move the server actually kept.
        if (!rooms.addMove(roomId, socket.id, finalizedMove)) return;

        io.to(socket.id).emit('your_move', finalizedMove);
        socket.broadcast.to(roomId).emit('user_draw', finalizedMove, socket.id);
      }),
    );

    socket.on(
      'undo',
      safeHandler('undo', () => {
        const roomId = getRoomId();
        if (!roomId) return;

        if (!rooms.undoMove(roomId, socket.id)) return;

        socket.broadcast.to(roomId).emit('user_undo', socket.id);
      }),
    );

    socket.on(
      'mouse_move',
      safeHandler('mouse_move', async (x, y) => {
        const roomId = getRoomId();
        if (!roomId) return;

        if (!(await withinLimit('mouse_move', socket.id))) return;

        const parsed = mouseMoveSchema.safeParse({ x, y });

        // Deliberately quiet: cursor updates arrive many times a second, and a
        // warn per bad packet would drown the log.
        if (!parsed.success) return;

        socket.broadcast
          .to(roomId)
          .emit('mouse_moved', parsed.data.x, parsed.data.y, socket.id);
      }),
    );

    socket.on(
      'send_msg',
      safeHandler('send_msg', async (msg) => {
        const roomId = getRoomId();
        if (!roomId) return;

        if (!(await withinLimit('send_msg', socket.id))) {
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

        io.to(roomId).emit('new_msg', socket.id, parsed.data);
      }),
    );

    socket.on(
      'disconnecting',
      safeHandler('disconnecting', () => {
        forgetSocket(socket.id);

        const roomId = getRoomId();
        if (!roomId) return;

        leaveRoom(roomId);

        io.to(roomId).emit('user_disconnected', socket.id);
      }),
    );
  });
};
