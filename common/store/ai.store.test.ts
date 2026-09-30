import { beforeEach, describe, expect, it } from 'vitest';

import type { AiStatusUpdate } from '@/common/types/global';

import { activityLabel, selectActivity, useAiStore } from './ai.store';

const update = (overrides: Partial<AiStatusUpdate>): AiStatusUpdate => ({
  requestId: 'r1',
  userId: 'u1',
  kind: 'draw',
  status: 'queued',
  ...overrides,
});

describe('ai store', () => {
  beforeEach(() => {
    useAiStore.setState({ requests: new Map(), mine: new Set(), promptOpen: false });
  });

  it('marks requests as mine only when this client minted them', () => {
    useAiStore.getState().markMine('r1');
    useAiStore.getState().applyStatus(update({ requestId: 'r1' }));
    useAiStore.getState().applyStatus(update({ requestId: 'r2', userId: 'u2' }));

    const { requests } = useAiStore.getState();

    expect(requests.get('r1')?.mine).toBe(true);
    expect(requests.get('r2')?.mine).toBe(false);
  });

  it('reports the most recent active request as Sketch’s activity', () => {
    const { applyStatus } = useAiStore.getState();

    expect(selectActivity(useAiStore.getState())).toBeNull();

    applyStatus(update({ requestId: 'r1', status: 'thinking' }));
    expect(selectActivity(useAiStore.getState())?.requestId).toBe('r1');

    applyStatus(update({ requestId: 'r1', status: 'done' }));
    expect(selectActivity(useAiStore.getState())).toBeNull();
  });

  it('labels progress for cursors and tooltips', () => {
    const base = { ...update({}), mine: false, updatedAt: 0 };

    expect(activityLabel({ ...base, status: 'thinking' })).toBe('thinking…');
    expect(activityLabel({ ...base, status: 'drawing' })).toBe('drawing');
    expect(
      activityLabel({ ...base, status: 'drawing', progress: { done: 3, total: 12 } }),
    ).toBe('drawing 3 of 12');
    expect(activityLabel({ ...base, status: 'queued' })).toBe('queued');
  });

  it('replaces the map rather than mutating it', () => {
    const before = useAiStore.getState().requests;

    useAiStore.getState().applyStatus(update({}));

    expect(useAiStore.getState().requests).not.toBe(before);
    expect(before.size).toBe(0);
  });
});
