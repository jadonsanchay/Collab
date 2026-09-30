const STORAGE_KEY = 'collab:userId';

let cached: string | null = null;

/**
 * This browser's stable user id, created once and kept in `localStorage`.
 *
 * Identity used to be `socket.id`, which is regenerated on every reconnect: a
 * dropped Wi-Fi connection made you a different person, orphaning your moves
 * and your colour. This id survives reconnects and reloads, which is what lets
 * the server hand the same session back.
 *
 * For a guest this is the identity. For a signed-in user the server answers
 * the handshake with the account id and the client adopts it here, so
 * everything keyed by "me" agrees with the server.
 */
export const getMyUserId = (): string => {
  if (cached) return cached;

  // Server-side rendering has no localStorage and no identity to speak of.
  // The value is only ever needed once the socket is live, in the browser.
  if (typeof window === 'undefined') return '';

  const stored = window.localStorage.getItem(STORAGE_KEY);

  if (stored) {
    cached = stored;

    return stored;
  }

  const created = window.crypto.randomUUID();

  window.localStorage.setItem(STORAGE_KEY, created);
  cached = created;

  return created;
};

/** Adopts the id the server resolved for this connection. */
export const setMyUserId = (userId: string) => {
  cached = userId;

  if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, userId);
};

/**
 * Forgets the current id and mints a fresh one: after signing out, or when
 * the server refuses the stored id because it belongs to an account.
 */
export const resetMyUserId = (): string => {
  cached = null;

  if (typeof window === 'undefined') return '';

  window.localStorage.removeItem(STORAGE_KEY);

  return getMyUserId();
};
