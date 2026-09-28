// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_ROOM, useRoom, useRoomStore } from '@/common/store/room.store';
import type { ClientRoom, Move } from '@/common/types/global';

import { makeMove } from '@/server/testing/fixtures';

/**
 * A stand-in for the socket module, which otherwise opens a real connection on
 * import. Only the listener plumbing matters here, so an EventEmitter is
 * enough — `emit` from a test plays the part of the server.
 */
const fakeSocket = new EventEmitter();

vi.mock('@/common/lib/socket', () => ({
  socket: {
    on: (event: string, listener: (...args: unknown[]) => void) =>
      fakeSocket.on(event, listener),
    off: (event: string, listener?: (...args: unknown[]) => void) =>
      listener ? fakeSocket.off(event, listener) : fakeSocket.removeAllListeners(event),
    emit: () => undefined,
  },
}));

// Imported after the mock is registered, so the hook picks up the fake.
const { useSocketDraw } = await import('./useSocketDraw');

/** Renders the hook and exposes the room state it writes into. */
const renderHook = (drawing: boolean) => {
  const seen: { current: ClientRoom | null } = { current: null };

  const Probe = ({ isDrawing }: { isDrawing: boolean }) => {
    useSocketDraw(isDrawing);
    seen.current = useRoom();

    return null;
  };

  const view = render(<Probe isDrawing={drawing} />);

  const rerender = (isDrawing: boolean) => view.rerender(<Probe isDrawing={isDrawing} />);

  return { seen, rerender, unmount: view.unmount };
};

const remoteDraw = (userId: string, move: Move) =>
  act(() => {
    fakeSocket.emit('user_draw', move, userId);
  });

const movesOf = (room: ClientRoom | null, userId: string) =>
  (room?.usersMoves.get(userId) ?? []).map((move) => move.id);

describe('useSocketDraw', () => {
  beforeEach(() => {
    fakeSocket.removeAllListeners();
    useRoomStore.setState({ room: DEFAULT_ROOM });
  });

  /**
   * Unlike the old `RecoilRoot` per render, the Zustand store is a global
   * singleton: a Probe left mounted from a previous test would keep its
   * socket listeners live and write into the next test's store.
   */
  afterEach(cleanup);

  it('applies remote moves straight away when not drawing', () => {
    const { seen } = renderHook(false);

    remoteDraw('user-bob', makeMove({ id: 'bob-1' }));
    remoteDraw('user-carol', makeMove({ id: 'carol-1' }));

    expect(movesOf(seen.current, 'user-bob')).toEqual(['bob-1']);
    expect(movesOf(seen.current, 'user-carol')).toEqual(['carol-1']);
  });

  it('holds moves that arrive mid-stroke and applies all of them afterwards', () => {
    const { seen, rerender } = renderHook(true);

    remoteDraw('user-bob', makeMove({ id: 'bob-1' }));
    remoteDraw('user-carol', makeMove({ id: 'carol-1' }));
    remoteDraw('user-bob', makeMove({ id: 'bob-2' }));

    // Nothing lands while the local stroke is in progress.
    expect(movesOf(seen.current, 'user-bob')).toEqual([]);
    expect(movesOf(seen.current, 'user-carol')).toEqual([]);

    // Ending the stroke re-runs the effect, and its cleanup is what flushes
    // the queue — the same path the real pointer-up takes.
    act(() => {
      rerender(false);
    });

    // Before the fix a single slot held the deferred move, so only 'bob-2'
    // survived and the two strokes before it were lost with no error.
    expect(movesOf(seen.current, 'user-bob')).toEqual(['bob-1', 'bob-2']);
    expect(movesOf(seen.current, 'user-carol')).toEqual(['carol-1']);
  });

  it('removes a move when its author undoes', () => {
    const { seen } = renderHook(false);

    remoteDraw('user-bob', makeMove({ id: 'bob-1' }));
    remoteDraw('user-bob', makeMove({ id: 'bob-2' }));

    act(() => {
      fakeSocket.emit('user_undo', 'user-bob');
    });

    expect(movesOf(seen.current, 'user-bob')).toEqual(['bob-1']);
  });
});
