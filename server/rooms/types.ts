import type { Move } from '@/common/types/global';

/**
 * Server-side room shape.
 *
 * Structurally identical to the wire `Room` in `common/types/global.d.ts`
 * today, which is why a `ServerRoom` can still be handed straight to
 * `io.emit('room', ...)`. It is declared separately because this is the seam
 * that diverges in Step 6: the server room becomes keyed by `userId` and grows
 * `seq`, `emptySince`, and per-user colour, while the wire type changes on its
 * own schedule.
 */
export type ServerRoom = {
  usersMoves: Map<string, Move[]>;
  drawed: Move[];
  users: Map<string, string>;
};
