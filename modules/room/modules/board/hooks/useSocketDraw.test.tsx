// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { act, render } from '@testing-library/react';
import { RecoilRoot, useRecoilValue } from 'recoil';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { roomAtom } from '@/common/recoil/room/room.atom';
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
    seen.current = useRecoilValue(roomAtom);

    return null;
  };

  const view = render(
    <RecoilRoot>
      <Probe isDrawing={drawing} />
    </RecoilRoot>,
  );

  const rerender = (isDrawing: boolean) =>
    view.rerender(
      <RecoilRoot>
        <Probe isDrawing={isDrawing} />
      </RecoilRoot>,
    );

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
  });

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
