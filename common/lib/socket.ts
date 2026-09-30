import { io, Socket } from 'socket.io-client';

import { PROTOCOL_VERSION } from '../constants/protocol';
import { useFeaturesStore } from '../store/features.store';
import { useSessionStore } from '../store/session.store';
import { ClientToServerEvents, ServerToClientEvents } from '../types/global';
import { getMyUserId, resetMyUserId, setMyUserId } from './identity';

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

/**
 * The server's verdict on who this connection is. A signed-in user's account
 * id replaces the browser's guest id everywhere "me" is compared; a guest's
 * id is mirrored into the signed cookie so HTTP routes know the guest too.
 */
socket.on('identity', (identity) => {
  if (identity.userId !== getMyUserId()) {
    setMyUserId(identity.userId);
    socket.auth = { ...socket.auth, userId: identity.userId };
  }

  useSessionStore.getState().setIdentity(identity);

  if (identity.isGuest && typeof window !== 'undefined') {
    fetch('/api/me/guest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: identity.userId }),
    }).catch(() => {});
  }
});

/**
 * The stored id belongs to an account this browser is not signed in to
 * (someone signed out, say): start over as a new guest rather than staying
 * refused forever.
 */
socket.on('connect_error', (error) => {
  if (error.message !== 'identity_taken') return;

  const userId = resetMyUserId();
  socket.auth = { ...socket.auth, userId };
  socket.connect();
});
