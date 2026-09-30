import { useEffect } from 'react';

import { isRedo, isTypingTarget, isUndo } from '@/common/lib/keyboard';
import { createObject, deleteObjects, updateObject } from '@/common/vector/doc';
import { bottomZ, topZ, zStep } from '@/common/vector/order';
import { isLocked, useVectorStore, type VectorTool } from '@/common/store/vector.store';

import { duplicateObject } from '@/common/vector/objects';
import type { VectorSession } from '../lib/session';

const TOOL_KEYS: Record<string, VectorTool> = {
  v: 'select',
  h: 'hand',
  p: 'pen',
  e: 'eraser',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
  a: 'arrow',
  t: 'text',
  s: 'sticky',
  c: 'connector',
  f: 'frame',
};

const TEXT_BEARING = new Set(['text', 'sticky', 'shape', 'frame', 'connector']);

/**
 * Keyboard for the vector board: single letters pick tools, the usual
 * modifiers act on the selection (delete, duplicate, select all, z-order,
 * lock, nudge), Enter edits text, Escape backs out, undo and redo go
 * through the per-user undo manager. Nothing fires while typing.
 */
export const useVectorKeyboard = (session: VectorSession | null) => {
  useEffect(() => {
    if (!session) return undefined;

    const listener = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;

      const store = useVectorStore.getState();
      const { objects, selection, editingId } = store;
      const readOnly = isLocked(store);
      const modifier = event.metaKey || event.ctrlKey;
      const selected = objects.filter((object) => selection.has(object.id));

      if (event.key === 'Escape') {
        if (editingId) store.setEditingId(null);
        else store.setSelection([]);
        return;
      }

      if (isRedo(event)) {
        event.preventDefault();
        if (!readOnly) session.undo.redo();
        return;
      }

      if (isUndo(event)) {
        event.preventDefault();
        if (!readOnly) session.undo.undo();
        return;
      }

      if (modifier && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        store.setSelection(objects.filter((object) => !object.locked).map((object) => object.id));
        return;
      }

      if (!modifier && !event.shiftKey && TOOL_KEYS[event.key.toLowerCase()]) {
        event.preventDefault();
        store.setTool(TOOL_KEYS[event.key.toLowerCase()]);
        return;
      }

      if (readOnly || !selected.length) return;

      // Each command below is its own undo step, except nudging, where
      // holding an arrow key should collapse into one.
      if (!event.key.startsWith('Arrow')) session.undo.stopCapturing();

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteObjects(session.doc, selected.filter((object) => !object.locked).map((object) => object.id), session.origin);
        store.setSelection([]);
        return;
      }

      if (event.key === 'Enter' && selected.length === 1 && TEXT_BEARING.has(selected[0].type)) {
        event.preventDefault();
        store.setEditingId(selected[0].id);
        return;
      }

      if (modifier && event.key.toLowerCase() === 'd') {
        event.preventDefault();

        const copies = selected.map((object) => duplicateObject(object, topZ(objects)));

        session.doc.transact(() => {
          copies.forEach((copy) => createObject(session.doc, copy));
        }, session.origin);
        store.setSelection(copies.map((copy) => copy.id));
        return;
      }

      if (modifier && (event.key === ']' || event.key === '[')) {
        event.preventDefault();

        session.doc.transact(() => {
          selected.forEach((object) => {
            const up = event.key === ']';
            let z: string | null;

            if (event.shiftKey) {
              z = up ? topZ(objects) : bottomZ(objects);
            } else {
              z = zStep(objects, object.id, up ? 'up' : 'down');
            }

            if (z) updateObject(session.doc, object.id, { z });
          });
        }, session.origin);
        return;
      }

      if (modifier && event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault();

        const lock = !selected.every((object) => object.locked);

        session.doc.transact(() => {
          selected.forEach((object) => updateObject(session.doc, object.id, { locked: lock || undefined }));
        }, session.origin);
        return;
      }

      const nudge: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };

      if (nudge[event.key]) {
        event.preventDefault();

        const [dx, dy] = nudge[event.key].map((delta) => delta * (event.shiftKey ? 10 : 1));

        session.doc.transact(() => {
          selected
            .filter((object) => !object.locked)
            .forEach((object) => updateObject(session.doc, object.id, { x: object.x + dx, y: object.y + dy }));
        }, session.origin);
      }
    };

    document.addEventListener('keydown', listener);

    return () => document.removeEventListener('keydown', listener);
  }, [session]);
};
