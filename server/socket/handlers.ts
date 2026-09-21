import type { Server } from 'socket.io';
import { v4 } from 'uuid';

import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@/common/types/global';

import type { RoomStore } from '../rooms/RoomStore';
import { safeHandler } from './safeHandler';

/**
 * Registers every socket event. Each handler is wrapped by `safeHandler` and
 * returns early when the socket is not in a room, so no client message can
 * reach room state that does not exist.
 */
export const registerSocketHandlers = (
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  rooms: RoomStore,
) => {
  io.on('connection', (socket) => {
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
      safeHandler('create_room', (username) => {
        const roomId = rooms.create(socket.id, username);

        socket.join(roomId);

        io.to(socket.id).emit('created', roomId);
      }),
    );

    socket.on(
      'check_room',
      safeHandler('check_room', (roomId) => {
        socket.emit('room_exists', rooms.has(roomId));
      }),
    );

    socket.on(
      'join_room',
      safeHandler('join_room', (roomId, username) => {
        if (rooms.join(roomId, socket.id, username)) {
          socket.join(roomId);

          io.to(socket.id).emit('joined', roomId);
        } else {
          // Echo the attempted id back so the client's modal can name the room
          // it could not get into.
          io.to(socket.id).emit('joined', roomId, true);
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
      safeHandler('draw', (move) => {
        const roomId = getRoomId();
        if (!roomId) return;

        const finalizedMove = { ...move, id: v4(), timestamp: Date.now() };

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
      safeHandler('mouse_move', (x, y) => {
        const roomId = getRoomId();
        if (!roomId) return;

        socket.broadcast.to(roomId).emit('mouse_moved', x, y, socket.id);
      }),
    );

    socket.on(
      'send_msg',
      safeHandler('send_msg', (msg) => {
        const roomId = getRoomId();
        if (!roomId) return;

        io.to(roomId).emit('new_msg', socket.id, msg);
      }),
    );

    socket.on(
      'disconnecting',
      safeHandler('disconnecting', () => {
        const roomId = getRoomId();
        if (!roomId) return;

        leaveRoom(roomId);

        io.to(roomId).emit('user_disconnected', socket.id);
      }),
    );
  });
};
