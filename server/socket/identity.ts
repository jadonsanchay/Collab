import type { Server, Socket } from 'socket.io';

import { PROTOCOL_VERSION } from '@/common/constants/protocol';
import { userIdSchema } from '@/common/schemas/user';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@/common/types/global';

import type { Identity } from '../auth/session';
import { logger } from '../logger';

/** What the handshake middleware attaches for every later handler to read. */
export type SocketData = {
  /** The identity every room operation is keyed by. */
  userId: string;
  /** The signed-in account, or null for a guest. */
  account: Identity | null;
  /**
   * The browser's stable id when it differs from the account it signed in
   * with: a guest who just logged in. The connection handler merges it.
   */
  claimedGuestId: string | null;
};

export type IdentityDeps = {
  /** Reads the Auth.js session from the handshake's cookie header. */
  resolveSession?: (cookieHeader: string | undefined) => Promise<Identity | null>;
  /**
   * True when an id belongs to a signed-in account. A guest handshake
   * presenting such an id is refused: without the session cookie, it is not
   * that person.
   */
  isAccountId?: (userId: string) => Promise<boolean>;
};

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
 * Rejects a connection unless it presents the protocol version this server
 * speaks and an identity it can trust.
 *
 * A session cookie is the account, full stop; the id the client sent is then
 * only a hint that a guest is becoming that account. Without a session the
 * client's uuid is the guest identity, as it has been since Phase 0.
 *
 * Refusing at the handshake is deliberate. A tab left open across a deploy
 * speaks the old contract, and letting it connect anyway is how two clients
 * end up with quietly different pictures of the same room. The client sees
 * the reason on `connect_error`, which is delivered reliably — unlike an
 * event emitted to a socket that is not connected yet.
 */
export const registerIdentity = (io: IOServer, deps: IdentityDeps = {}) => {
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

    const claimed = userIdSchema.safeParse(userId);

    const resolve = async () => {
      const session = deps.resolveSession
        ? await deps.resolveSession(socket.handshake.headers.cookie)
        : null;

      if (session) {
        /* eslint-disable no-param-reassign -- `socket.data` is the mechanism
           Socket.IO provides for handing handshake-derived values to handlers. */
        socket.data.userId = session.userId;
        socket.data.account = session;
        socket.data.claimedGuestId =
          claimed.success && claimed.data !== session.userId ? claimed.data : null;
        /* eslint-enable no-param-reassign */

        return;
      }

      if (!claimed.success) {
        logger.warn({ socketId: socket.id }, 'refused a connection with no valid user id');

        throw new Error('invalid_user_id');
      }

      if (deps.isAccountId && (await deps.isAccountId(claimed.data))) {
        logger.warn({ socketId: socket.id }, 'refused a guest handshake using an account id');

        throw new Error('identity_taken');
      }

      /* eslint-disable no-param-reassign */
      socket.data.userId = claimed.data;
      socket.data.account = null;
      socket.data.claimedGuestId = null;
      /* eslint-enable no-param-reassign */
    };

    resolve().then(
      () => next(),
      (error: Error) => next(error),
    );
  });
};
