import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  createObject,
  createUndoManager,
  deleteObjects,
  getObject,
  observeObjects,
  readAll,
  setText,
  textOf,
  updateObject,
} from './doc';
import type { ShapeObject, StickyObject } from './types';

const sticky = (id: string, z: string, text = 'hello'): StickyObject => ({
  id,
  type: 'sticky',
  x: 0,
  y: 0,
  w: 200,
  h: 200,
  rotation: 0,
  z,
  createdBy: 'alice',
  createdAt: 1,
  text,
  fill: '#FEF08A',
  fontSize: 18,
});

describe('vector document', () => {
  it('stores objects as Y.Maps with Y.Text fields and reads them back sorted by z', () => {
    const doc = new Y.Doc();

    createObject(doc, sticky('b', 'a1', 'second'));
    createObject(doc, sticky('a', 'a0', 'first'));

    expect(readAll(doc).map((object) => object.id)).toEqual(['a', 'b']);
    expect(getObject(doc, 'a')).toMatchObject({ text: 'first', fill: '#FEF08A' });
    expect(textOf(doc, 'a', 'text')).toBeInstanceOf(Y.Text);
    expect(textOf(doc, 'a', 'fill')).toBeNull();
  });

  it('patches non-text fields and leaves text to the Y.Text', () => {
    const doc = new Y.Doc();

    createObject(doc, sticky('a', 'a0'));
    updateObject(doc, 'a', { x: 50, locked: true, text: 'ignored' });

    expect(getObject(doc, 'a')).toMatchObject({ x: 50, locked: true, text: 'hello' });

    setText(doc, 'a', 'text', 'replaced');
    expect((getObject(doc, 'a') as StickyObject).text).toBe('replaced');

    updateObject(doc, 'a', { locked: undefined });
    expect(getObject(doc, 'a')?.locked).toBeUndefined();

    deleteObjects(doc, ['a', 'missing']);
    expect(readAll(doc)).toEqual([]);
  });

  it('merges concurrent edits to different fields of one object', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();

    createObject(a, sticky('s', 'a0'));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    updateObject(a, 's', { x: 100 });
    updateObject(b, 's', { fill: '#BBF7D0' });
    textOf(b, 's', 'text')?.insert(5, ' world');

    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    expect(getObject(a, 's')).toMatchObject({ x: 100, fill: '#BBF7D0', text: 'hello world' });
    expect(getObject(b, 's')).toEqual(getObject(a, 's'));
  });

  it('undoes only this client’s changes', () => {
    const doc = new Y.Doc();
    const mine = { client: 'me' };
    const theirs = { client: 'them' };
    const undo = createUndoManager(doc, mine);

    createObject(doc, sticky('mine', 'a0'), mine);
    createObject(doc, sticky('theirs', 'a1'), theirs);

    undo.undo();

    expect(readAll(doc).map((object) => object.id)).toEqual(['theirs']);

    undo.redo();
    expect(readAll(doc).map((object) => object.id)).toEqual(['mine', 'theirs']);
  });

  it('notifies on deep changes, including text', () => {
    const doc = new Y.Doc();
    let calls = 0;
    const stop = observeObjects(doc, () => {
      calls += 1;
    });

    createObject(doc, sticky('a', 'a0'));
    textOf(doc, 'a', 'text')?.insert(0, 'x');
    stop();
    updateObject(doc, 'a', { x: 1 });

    expect(calls).toBe(2);
  });

  it('reads an object missing a text field as empty text', () => {
    const doc = new Y.Doc();
    const ymap = new Y.Map<unknown>();
    const shape: Omit<ShapeObject, 'text'> = {
      id: 's',
      type: 'shape',
      kind: 'rect',
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      rotation: 0,
      z: 'a0',
      createdBy: 'u',
      createdAt: 0,
      stroke: '#000',
      fill: null,
      strokeWidth: 1,
    };
    Object.entries(shape).forEach(([key, value]) => ymap.set(key, value));
    doc.getMap('objects').set('s', ymap);

    expect((getObject(doc, 's') as ShapeObject).text).toBe('');
  });
});
