/**
 * Wire protocol version, sent by the client in the socket handshake and
 * checked by the server.
 *
 * Bump this whenever a change to the socket contract would make an older tab
 * misbehave rather than simply miss a feature. A tab left open across a deploy
 * is then refused at the handshake instead of silently speaking the old
 * protocol — which is how divergent state and unexplainable bugs start.
 *
 * History: 1 — Phase 0 (stable identity, seq). 2 — Phase 2: `userId` on
 * every move, `text` shape, `moves_removed`, `features`, the AI events, and
 * the removal of the legacy `mouse_move` relay.
 */
export const PROTOCOL_VERSION = 2;
