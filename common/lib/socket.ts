import { io, Socket } from 'socket.io-client';

import { PROTOCOL_VERSION } from '../constants/protocol';
import { useFeaturesStore } from '../store/features.store';
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

/**
 * `features` is the first thing the server sends after the handshake, and on
 * localhost the handshake finishes before React has hydrated. A listener
 * attached in an effect misses it; one attached here, the moment the socket
 * exists, cannot. Re-sent on every reconnect, so a redeploy that flips a flag
 * reaches open tabs too.
 */
socket.on('features', (features) => {
  useFeaturesStore.getState().setFeatures(features);
});
