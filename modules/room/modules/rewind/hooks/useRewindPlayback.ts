import { useEffect } from 'react';

import { useHistoryStore } from '@/common/store/history.store';

/** Playback advances this often; `speed` moves land per tick. */
const TICK_MS = 250;

/**
 * Drives playback: while `playing`, the cursor advances `speed` sequence
 * numbers per tick and stops at the end of the board. Reads the latest
 * `maxSeq` through a ref-like getter so a board that grows during playback
 * does not restart the interval.
 */
export const useRewindPlayback = (getMaxSeq: () => number) => {
  const playing = useHistoryStore((state) => state.view.playing);
  const speed = useHistoryStore((state) => state.view.speed);

  useEffect(() => {
    if (!playing) return undefined;

    const interval = setInterval(() => {
      const { view, setCursorSeq, setPlaying } = useHistoryStore.getState();
      const end = getMaxSeq();
      const current = view.cursorSeq ?? 0;

      if (current >= end) {
        setPlaying(false);
        return;
      }

      setCursorSeq(Math.min(end, current + speed));
    }, TICK_MS);

    return () => clearInterval(interval);
  }, [playing, speed, getMaxSeq]);
};
