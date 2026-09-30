import type { ClientRoom, Move } from '@/common/types/global';

import type { HistoryView } from '../store/history.store';

/**
 * Every move in the room — departed users', mine, everyone else's — in the
 * order all clients agree on. `seq` is the server's sequence and wins;
 * `timestamp` only orders moves that have not been through the server yet,
 * which sort with `seq` 0.
 */
export const sortMoves = (room: ClientRoom): Move[] => {
  const moves = [...room.movesWithoutUser, ...room.myMoves];

  room.usersMoves.forEach((userMoves) => moves.push(...userMoves));

  moves.sort((a, b) => {
    if (a.seq && b.seq) return a.seq - b.seq;

    return a.timestamp - b.timestamp;
  });

  return moves;
};

/**
 * The moves Rewind shows for a view: everything up to the cursor that passes
 * the author filter, in the order given. Live (`cursorSeq === null`) with no
 * filter returns the input untouched, so the normal path allocates nothing.
 *
 * Pure so the renderer decision can be unit-tested without a canvas, and so
 * the timelapse exporter can reuse it frame by frame.
 */
export const visibleMoves = (
  sortedMoves: Move[],
  view: Pick<HistoryView, 'cursorSeq' | 'userFilter'>,
): Move[] => {
  const { cursorSeq, userFilter } = view;

  if (cursorSeq === null && userFilter === null) return sortedMoves;

  return sortedMoves.filter(
    (move) =>
      (cursorSeq === null || move.seq <= cursorSeq) &&
      (userFilter === null || userFilter.has(move.userId)),
  );
};

/** The highest sequence number on the board, or 0 when it is empty. */
export const maxSeq = (moves: Move[]): number =>
  moves.reduce((highest, move) => Math.max(highest, move.seq), 0);
