/**
 * The AI teammate's identity. It is a room member like any other — same
 * user list, same cursor events, same moves — so clients need no special
 * handling beyond recognising the id for labels and status.
 *
 * Not a uuid on purpose: the handshake requires one from humans, so nobody
 * can present this id and impersonate Sketch.
 */
export const AI_USER_ID = 'ai:sketch';
export const AI_USER_NAME = 'Sketch';
/** Reserved: not in `COLORS_ARRAY`, so no human is ever assigned it. */
export const AI_USER_COLOR = '#FFB000';

export const isAiUser = (userId: string) => userId === AI_USER_ID;
