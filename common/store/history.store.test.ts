import { beforeEach, describe, expect, it } from 'vitest';

import { makeMove } from '@/server/testing/fixtures';

import { isViewingHistory, useHistoryStore } from './history.store';

describe('history store', () => {
  beforeEach(() => {
    useHistoryStore.getState().goLive();
    useHistoryStore.getState().setUserFilter(null);
    useHistoryStore.getState().setPanelOpen(false);
    useHistoryStore.getState().clearSavedMoves();
  });

  it('is live by default and viewing history once a cursor is set', () => {
    expect(isViewingHistory()).toBe(false);

    useHistoryStore.getState().setCursorSeq(3);

    expect(isViewingHistory()).toBe(true);
    expect(useHistoryStore.getState().view.cursorSeq).toBe(3);
  });

  it('goes live by clearing the cursor and stopping playback, but keeps the author filter', () => {
    const { setCursorSeq, setPlaying, setUserFilter, goLive } = useHistoryStore.getState();

    setCursorSeq(2);
    setPlaying(true);
    setUserFilter(new Set(['alice']));

    goLive();

    const { view } = useHistoryStore.getState();

    expect(view.cursorSeq).toBeNull();
    expect(view.playing).toBe(false);
    expect(view.userFilter).toEqual(new Set(['alice']));
  });

  it('keeps the redo stack independent of the view', () => {
    useHistoryStore.getState().addSavedMove(makeMove({ id: 'm' }));
    useHistoryStore.getState().setCursorSeq(1);

    expect(useHistoryStore.getState().savedMoves).toHaveLength(1);
    expect(useHistoryStore.getState().removeSavedMove()?.id).toBe('m');
  });

  it('cycles speed and panel state through their setters', () => {
    useHistoryStore.getState().setSpeed(16);
    useHistoryStore.getState().setPanelOpen(true);

    expect(useHistoryStore.getState().view).toMatchObject({ speed: 16, panelOpen: true });
  });
});
