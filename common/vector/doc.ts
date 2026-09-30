import * as Y from 'yjs';

import { byZ } from './order';
import { type BoardObject, type ObjectType, TEXT_FIELDS } from './types';

export const OBJECTS_KEY = 'objects';
export const META_KEY = 'meta';

/** One `Y.Map` per object under `objects`, so two people editing different fields of one sticky both win. */
export const objectsMap = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>(OBJECTS_KEY);

export const metaMap = (doc: Y.Doc) => doc.getMap<unknown>(META_KEY);

/** Field names that live as `Y.Text` for this object type. */
const textFieldsOf = (type: ObjectType): string[] => TEXT_FIELDS[type] ?? [];

/** Plain object from its `Y.Map`, `Y.Text` fields flattened to strings. */
export const readObject = (ymap: Y.Map<unknown>): BoardObject | null => {
  const raw: Record<string, unknown> = {};

  ymap.forEach((value, key) => {
    raw[key] = value instanceof Y.Text ? value.toString() : value;
  });

  if (typeof raw.id !== 'string' || typeof raw.type !== 'string') return null;

  // Text fields absent on an older object read as empty rather than undefined.
  textFieldsOf(raw.type as ObjectType).forEach((field) => {
    if (raw[field] === undefined) raw[field] = '';
  });

  return raw as unknown as BoardObject;
};

/** Every object in the document, bottom to top. */
export const readAll = (doc: Y.Doc): BoardObject[] => {
  const objects: BoardObject[] = [];

  objectsMap(doc).forEach((ymap) => {
    const object = readObject(ymap);
    if (object) objects.push(object);
  });

  return objects.sort(byZ);
};

export const getObject = (doc: Y.Doc, id: string): BoardObject | null => {
  const ymap = objectsMap(doc).get(id);

  return ymap ? readObject(ymap) : null;
};

/**
 * Writes a whole object into the map. Text fields become `Y.Text` so later
 * edits merge character by character; everything else is a plain value.
 */
export const createObject = (doc: Y.Doc, object: BoardObject, origin?: unknown) => {
  doc.transact(() => {
    const ymap = new Y.Map<unknown>();
    const texts = textFieldsOf(object.type);

    Object.entries(object).forEach(([key, value]) => {
      if (texts.includes(key)) {
        const text = new Y.Text();
        if (typeof value === 'string' && value) text.insert(0, value);
        ymap.set(key, text);
      } else if (value !== undefined) {
        ymap.set(key, value);
      }
    });

    objectsMap(doc).set(object.id, ymap);
  }, origin);
};

/**
 * Sets non-text fields on an existing object. Text fields are edited
 * through their `Y.Text` (see `textOf`), never replaced wholesale, or two
 * people's keystrokes would overwrite each other.
 */
export const updateObject = (
  doc: Y.Doc,
  id: string,
  patch: Partial<BoardObject>,
  origin?: unknown,
) => {
  const ymap = objectsMap(doc).get(id);
  if (!ymap) return;

  const type = ymap.get('type') as ObjectType | undefined;
  const texts = type ? textFieldsOf(type) : [];

  doc.transact(() => {
    Object.entries(patch).forEach(([key, value]) => {
      if (key === 'id' || key === 'type' || texts.includes(key)) return;

      if (value === undefined) ymap.delete(key);
      else ymap.set(key, value);
    });
  }, origin);
};

export const deleteObjects = (doc: Y.Doc, ids: string[], origin?: unknown) => {
  doc.transact(() => {
    ids.forEach((id) => objectsMap(doc).delete(id));
  }, origin);
};

/** The `Y.Text` behind a text field, for the editor binding. Null when absent. */
export const textOf = (doc: Y.Doc, id: string, field: string): Y.Text | null => {
  const value = objectsMap(doc).get(id)?.get(field);

  return value instanceof Y.Text ? value : null;
};

/** Replaces a text field's contents in one transaction (a paste, a template). */
export const setText = (doc: Y.Doc, id: string, field: string, value: string, origin?: unknown) => {
  const text = textOf(doc, id, field);
  if (!text) return;

  doc.transact(() => {
    if (text.length) text.delete(0, text.length);
    if (value) text.insert(0, value);
  }, origin);
};

/**
 * Per-user undo: every local change carries this client's origin, and the
 * manager only tracks that origin, so undo touches only what this person
 * did — the same semantics the raster board has.
 */
export const createUndoManager = (doc: Y.Doc, origin: unknown) =>
  new Y.UndoManager(objectsMap(doc), {
    trackedOrigins: new Set([origin]),
    captureTimeout: 300,
  });

/** Calls `listener` after any change to the objects map (deep: fields and text too). */
export const observeObjects = (doc: Y.Doc, listener: (events: Y.YEvent<Y.AbstractType<unknown>>[]) => void) => {
  const map = objectsMap(doc);

  map.observeDeep(listener);

  return () => map.unobserveDeep(listener);
};
