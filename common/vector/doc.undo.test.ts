import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { createObject, createUndoManager, deleteObjects, readAll } from './doc';
import type { StrokeObject } from './types';

const sleep = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

const stroke = (id: string): StrokeObject => ({
  id,
  type: 'stroke',
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  rotation: 0,
  z: 'a0',
  createdBy: 'me',
  createdAt: 1,
  points: [[0, 0, 0.5], [10, 10, 0.5]],
  color: '#000',
  size: 4,
});

describe('undoing a deletion', () => {
  it('brings a deleted object back with its fields, and redo removes it again', async () => {
    const doc = new Y.Doc();
    const origin = { userId: 'me' };
    const undo = createUndoManager(doc, origin);

    createObject(doc, stroke('s1'), origin);
    // Past the capture window, so the delete is its own undo step.
    await sleep(350);
    deleteObjects(doc, ['s1'], origin);

    expect(readAll(doc)).toHaveLength(0);

    undo.undo();

    expect(readAll(doc)).toHaveLength(1);
    expect(readAll(doc)[0]).toMatchObject({ id: 's1', type: 'stroke', color: '#000', size: 4 });

    undo.redo();

    expect(readAll(doc)).toHaveLength(0);
  });
});
