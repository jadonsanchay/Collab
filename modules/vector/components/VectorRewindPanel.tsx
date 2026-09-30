import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Pause, Play, Radio, X } from 'lucide-react';
import * as Y from 'yjs';

import HotkeyTooltip from '@/common/components/HotkeyTooltip';
import { Slider } from '@/common/components/ui/slider';
import { AI_USER_COLOR, AI_USER_NAME, isAiUser } from '@/common/constants/ai';
import { useFeatureFlag } from '@/common/hooks/useFeatureFlag';
import { getMyUserId } from '@/common/lib/identity';
import { isRewind, isTypingTarget } from '@/common/lib/keyboard';
import { useHistoryStore, type PlaybackSpeed } from '@/common/store/history.store';
import { useRoom } from '@/common/store/room.store';
import { useVectorStore } from '@/common/store/vector.store';
import { readAll } from '@/common/vector/doc';
import type { BoardObject } from '@/common/vector/types';
import { useRewindPlayback } from '@/modules/room/modules/rewind/hooks/useRewindPlayback';

const SPEEDS: PlaybackSpeed[] = [1, 4, 16];

type LogEntry = { seq: number; userId: string | null; update: Uint8Array };

type Author = { userId: string; name: string; color: string };

const decode = (base64: string) => Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));

/**
 * Rewind for an objects board. The server keeps every document update in
 * order; applying the first k to an empty document gives the board as it
 * was after k changes. The panel fetches that log when opened, rebuilds the
 * document at the scrubbed position (incrementally while moving forward),
 * and hands the result to the renderer through `historyObjects`, which
 * also locks the tools. The same store as the raster panel, so the top bar
 * toggle, the hotkey and the "Viewing history" banner are shared.
 */
const VectorRewindPanel = () => {
  const enabled = useFeatureFlag('rewind');
  const persistent = useFeatureFlag('persistent');
  const room = useRoom();
  const view = useHistoryStore((state) => state.view);
  const setPanelOpen = useHistoryStore((state) => state.setPanelOpen);
  const setCursorSeq = useHistoryStore((state) => state.setCursorSeq);
  const setUserFilter = useHistoryStore((state) => state.setUserFilter);
  const setPlaying = useHistoryStore((state) => state.setPlaying);
  const setSpeed = useHistoryStore((state) => state.setSpeed);
  const goLive = useHistoryStore((state) => state.goLive);
  const liveObjects = useVectorStore((state) => state.objects);

  const [log, setLog] = useState<LogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const built = useRef<{ doc: Y.Doc; applied: number } | null>(null);
  const endRef = useRef(0);

  const end = log?.length ?? 0;
  endRef.current = end;

  const getEnd = useCallback(() => endRef.current, []);
  useRewindPlayback(getEnd);

  // The log is fetched each time the panel opens, so it is current then.
  useEffect(() => {
    if (!view.panelOpen || !persistent || !room.id) return undefined;

    let cancelled = false;
    setError(null);

    fetch(`/api/boards/${room.id}/doc-updates`)
      .then(async (response) => {
        if (!response.ok) throw new Error('history unavailable');

        const body = (await response.json()) as {
          updates: { seq: number; userId: string | null; update: string }[];
        };

        if (!cancelled) setLog(body.updates.map((entry) => ({ ...entry, update: decode(entry.update) })));
      })
      .catch(() => {
        if (!cancelled) setError('History could not be loaded.');
      });

    return () => {
      cancelled = true;
    };
  }, [view.panelOpen, persistent, room.id]);

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

  // What the renderer shows: the past at the cursor, filtered by author.
  useEffect(() => {
    const { cursorSeq, userFilter } = view;
    const { setHistoryObjects } = useVectorStore.getState();
    const filtered = (objects: BoardObject[]) =>
      userFilter ? objects.filter((object) => userFilter.has(object.createdBy)) : objects;

    if (cursorSeq === null) {
      setHistoryObjects(userFilter ? filtered(liveObjects) : null);
      return;
    }

    if (!log) return;

    const target = Math.min(cursorSeq, log.length);
    let { current } = built;

    // Forward: apply what is missing. Backward: start over, Yjs cannot unapply.
    if (!current || current.applied > target) {
      current?.doc.destroy();
      current = { doc: new Y.Doc(), applied: 0 };
      built.current = current;
    }

    for (let i = current.applied; i < target; i += 1) Y.applyUpdate(current.doc, log[i].update);
    current.applied = target;

    setHistoryObjects(filtered(readAll(current.doc)));
  }, [view, log, liveObjects]);

  // Leaving the board or closing the panel returns the renderer to live.
  useEffect(
    () => () => {
      useVectorStore.getState().setHistoryObjects(null);
      built.current?.doc.destroy();
      built.current = null;
    },
    [],
  );

  const authors = useMemo<Author[]>(() => {
    const me = getMyUserId();
    const seen = new Map<string, Author>();
    const ids = [...(log ?? []).map((entry) => entry.userId), ...liveObjects.map((object) => object.createdBy)];

    ids.forEach((userId) => {
      if (!userId || seen.has(userId)) return;

      const user = room.users.get(userId);
      let name = 'Former participant';
      let color = '#9CA3AF';

      if (userId === me) {
        name = 'You';
        color = '#111827';
      } else if (isAiUser(userId)) {
        name = AI_USER_NAME;
        color = AI_USER_COLOR;
      } else if (user) {
        ({ name, color } = user);
      }

      seen.set(userId, { userId, name, color });
    });

    return [...seen.values()];
  }, [log, liveObjects, room.users]);

  if (!enabled || !view.panelOpen) return null;

  const position = view.cursorSeq ?? end;
  const live = view.cursorSeq === null;

  const close = () => {
    goLive();
    setPanelOpen(false);
  };

  const toggleAuthor = (userId: string) => {
    const all = new Set(authors.map((author) => author.userId));
    const next = new Set(view.userFilter ?? all);

    if (next.has(userId)) next.delete(userId);
    else next.add(userId);

    setUserFilter(next.size === all.size ? null : next);
  };

  const togglePlay = () => {
    if (view.playing) {
      setPlaying(false);
      return;
    }

    if (position >= end) setCursorSeq(0);
    setPlaying(true);
  };

  const cycleSpeed = () => {
    const index = SPEEDS.indexOf(view.speed);
    setSpeed(SPEEDS[(index + 1) % SPEEDS.length]);
  };

  let notice: string | null = null;
  if (!persistent) notice = 'Rewind needs a server that keeps boards (STORAGE=pglite or postgres).';
  else if (error) notice = error;

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

        <HotkeyTooltip label="Close">
          <button type="button" aria-label="Close rewind" className="btn-icon" onClick={close}>
            <X />
          </button>
        </HotkeyTooltip>
      </div>

      {notice && <p className="text-xs text-amber-300">{notice}</p>}

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
                <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: author.color }} />
                {author.name}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default VectorRewindPanel;
