import type { Server, Socket } from 'socket.io';

import { PROTOCOL_VERSION } from '@/common/constants/protocol';
import { userIdSchema } from '@/common/schemas/user';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@/common/types/global';

import { logger } from '../logger';

/** What the handshake middleware attaches for every later handler to read. */
export type SocketData = { userId: string };

type IOServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

type IOSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

/**
 * Rejects a connection unless it presents a valid user id and the protocol
 * version this server speaks.
 *
 * Refusing at the handshake is deliberate. A tab left open across a deploy
 * speaks the old contract, and letting it connect anyway is how two clients end
 * up with quietly different pictures of the same room. The client sees the
 * reason on `connect_error`, which is delivered reliably — unlike an event
 * emitted to a socket that is not connected yet.
 */
export const registerIdentity = (io: IOServer) => {
  io.use((socket: IOSocket, next) => {
    const { userId, protocolVersion } = socket.handshake.auth;

    if (protocolVersion !== PROTOCOL_VERSION) {
      logger.info(
        { got: protocolVersion, expected: PROTOCOL_VERSION },
        'refused a connection speaking another protocol version',
      );

      next(new Error('protocol_mismatch'));
      return;
    }

    const parsed = userIdSchema.safeParse(userId);

    if (!parsed.success) {
      logger.warn(
        { socketId: socket.id },
        'refused a connection with no valid user id',
      );

      next(new Error('invalid_user_id'));
      return;
    }

    /* eslint-disable-next-line no-param-reassign -- `socket.data` is the
       mechanism Socket.IO provides for handing handshake-derived values to
       handlers; there is nowhere else to put it. */
    socket.data.userId = parsed.data;

    next();
  });
};
