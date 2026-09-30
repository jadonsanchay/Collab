import { useCallback, useEffect, useMemo } from 'react';

import { Download, Pause, Play, Radio, X } from 'lucide-react';

import HotkeyTooltip from '@/common/components/HotkeyTooltip';
import { Slider } from '@/common/components/ui/slider';
import { AI_USER_COLOR, AI_USER_NAME, isAiUser } from '@/common/constants/ai';
import { useFeatureFlag } from '@/common/hooks/useFeatureFlag';
import { getMyUserId } from '@/common/lib/identity';
import { isRewind, isTypingTarget } from '@/common/lib/keyboard';
import { maxSeq, sortMoves } from '@/common/render/historyView';
import { useHistoryStore, type PlaybackSpeed } from '@/common/store/history.store';
import { useRoom, useRoomStore } from '@/common/store/room.store';

import { useRewindPlayback } from '../hooks/useRewindPlayback';
import { useTimelapseExport } from '../hooks/useTimelapseExport';

const SPEEDS: PlaybackSpeed[] = [1, 4, 16];

type Author = { userId: string; name: string; color: string };

/**
 * The history panel: a scrubber over the board's sequence numbers, playback
 * at three speeds, one chip per author to filter by, a way back to live, and
 * a timelapse export. Opened from the top bar clock or Cmd+Shift+H; closed
 * by default, in which case it changes nothing about how the board renders.
 */
const RewindPanel = () => {
  const enabled = useFeatureFlag('rewind');
  const room = useRoom();
  const view = useHistoryStore((state) => state.view);
  const setPanelOpen = useHistoryStore((state) => state.setPanelOpen);
  const setCursorSeq = useHistoryStore((state) => state.setCursorSeq);
  const setUserFilter = useHistoryStore((state) => state.setUserFilter);
  const setPlaying = useHistoryStore((state) => state.setPlaying);
  const setSpeed = useHistoryStore((state) => state.setSpeed);
  const goLive = useHistoryStore((state) => state.goLive);
  const { exportTimelapse, exporting, supported } = useTimelapseExport();

  const moves = useMemo(() => sortMoves(room), [room]);
  const end = useMemo(() => maxSeq(moves), [moves]);
  const getEnd = useCallback(() => maxSeq(sortMoves(useRoomStore.getState().room)), []);

  useRewindPlayback(getEnd);

  // Cmd+Shift+H toggles the panel; closing it always returns to live.
  useEffect(() => {
    if (!enabled) return undefined;

    const listener = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || !isRewind(event)) return;

      event.preventDefault();

      const { view: current, setPanelOpen: setOpen, goLive: live } = useHistoryStore.getState();

      if (current.panelOpen) live();
      setOpen(!current.panelOpen);
    };

    document.addEventListener('keydown', listener);

    return () => document.removeEventListener('keydown', listener);
  }, [enabled]);

  const authors = useMemo<Author[]>(() => {
    const me = getMyUserId();
    const seen = new Map<string, Author>();

    moves.forEach((move) => {
      if (seen.has(move.userId)) return;

      const user = room.users.get(move.userId);

      let name = 'Former participant';
      let color = '#9CA3AF';

      if (move.userId === me) {
        name = 'You';
        color = '#111827';
      } else if (isAiUser(move.userId)) {
        name = AI_USER_NAME;
        color = AI_USER_COLOR;
      } else if (user) {
        ({ name, color } = user);
      }

      seen.set(move.userId, { userId: move.userId, name, color });
    });

    return [...seen.values()];
  }, [moves, room.users]);

  if (!enabled || !view.panelOpen) return null;

  const position = view.cursorSeq ?? end;
  const live = view.cursorSeq === null;

  const toggleAuthor = (userId: string) => {
    const all = new Set(authors.map((author) => author.userId));
    const next = new Set(view.userFilter ?? all);

    if (next.has(userId)) next.delete(userId);
    else next.add(userId);

    // Everyone selected is the same as no filter.
    setUserFilter(next.size === all.size ? null : next);
  };

  const close = () => {
    goLive();
    setPanelOpen(false);
  };

  const togglePlay = () => {
    if (view.playing) {
      setPlaying(false);
      return;
    }

    // Playing from the end starts over.
    if (position >= end) setCursorSeq(0);
    setPlaying(true);
  };

  const cycleSpeed = () => {
    const index = SPEEDS.indexOf(view.speed);
    setSpeed(SPEEDS[(index + 1) % SPEEDS.length]);
  };

  return (
    <section
      aria-label="Rewind"
      className="fixed bottom-20 left-1/2 z-40 flex w-[min(56rem,95vw)] -translate-x-1/2 flex-col gap-3 rounded-xl bg-zinc-900 p-4 text-white shadow-2xl"
    >
      <div className="flex items-center gap-3">
        <HotkeyTooltip label={view.playing ? 'Pause' : 'Play'}>
          <button
            type="button"
            aria-label={view.playing ? 'Pause' : 'Play'}
            className="btn-icon"
            disabled={end === 0}
            onClick={togglePlay}
          >
            {view.playing ? <Pause /> : <Play />}
          </button>
        </HotkeyTooltip>

        <button
          type="button"
          aria-label="Playback speed"
          className="min-w-12 rounded-md bg-zinc-700 px-2 py-1 text-xs font-semibold"
          onClick={cycleSpeed}
        >
          {view.speed}×
        </button>

        <Slider
          aria-label="History position"
          className="flex-1"
          min={0}
          max={Math.max(end, 1)}
          step={1}
          value={[position]}
          disabled={end === 0}
          onValueChange={([value]) => {
            setPlaying(false);
            setCursorSeq(value);
          }}
        />

        <span className="min-w-20 text-right text-xs tabular-nums text-zinc-300">
          {position} / {end}
        </span>

        <HotkeyTooltip label="Back to live">
          <button
            type="button"
            aria-label="Live"
            aria-pressed={live}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ${
              live ? 'bg-green-500 text-black' : 'bg-zinc-700'
            }`}
            onClick={goLive}
          >
            <Radio className="size-3" /> Live
          </button>
        </HotkeyTooltip>

        <HotkeyTooltip
          label={
            supported
              ? 'Export a WebM timelapse'
              : 'Timelapse export needs MediaRecorder, which this browser lacks'
          }
        >
          <button
            type="button"
            aria-label="Export timelapse"
            className="btn-icon"
            disabled={!supported || exporting || end === 0}
            onClick={exportTimelapse}
          >
            <Download />
          </button>
        </HotkeyTooltip>

        <HotkeyTooltip label="Close">
          <button type="button" aria-label="Close rewind" className="btn-icon" onClick={close}>
            <X />
          </button>
        </HotkeyTooltip>
      </div>

      {authors.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" aria-label="Filter by author">
          {authors.map((author) => {
            const selected = view.userFilter === null || view.userFilter.has(author.userId);

            return (
              <button
                type="button"
                key={author.userId}
                aria-pressed={selected}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${
                  selected ? 'border-transparent bg-zinc-700' : 'border-zinc-600 opacity-50'
                }`}
                onClick={() => toggleAuthor(author.userId)}
              >
                <span
                  className="inline-block size-2.5 rounded-full"
                  style={{ backgroundColor: author.color }}
                />
                {author.name}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default RewindPanel;
