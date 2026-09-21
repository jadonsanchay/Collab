import { io, Socket } from 'socket.io-client';

import { PROTOCOL_VERSION } from '../constants/protocol';
import { ClientToServerEvents, ServerToClientEvents } from '../types/global';
import { getMyUserId } from './identity';

/**
 * The handshake carries who we are and which protocol we speak. Identity has
 * to arrive here rather than in a later event, because the server keys room
 * state by it from the moment the socket connects.
 */
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  auth: {
    userId: getMyUserId(),
    protocolVersion: PROTOCOL_VERSION,
  },
});
