const STORAGE_KEY = 'collab:userId';

let cached: string | null = null;

/**
 * This browser's stable user id, created once and kept in `localStorage`.
 *
 * Identity used to be `socket.id`, which is regenerated on every reconnect: a
 * dropped Wi-Fi connection made you a different person, orphaning your moves
 * and your colour. This id survives reconnects and reloads, which is what lets
 * the server hand the same session back.
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
