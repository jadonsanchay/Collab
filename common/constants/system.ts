/**
 * Author of the synthetic image move that stands in for a board's compacted
 * history: everything up to the snapshot's sequence number, rendered on the
 * server into one picture so a cold board loads in one image plus a tail
 * of moves instead of thousands of moves.
 */
export const SNAPSHOT_USER_ID = 'system:snapshot';

export const isSystemUser = (userId: string) => userId.startsWith('system:');
