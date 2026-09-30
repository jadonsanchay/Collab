import { generateKeyBetween } from 'fractional-indexing';

import type { BoardObject } from './types';

/** Sorts by `z`, then by id for a total order. */
export const byZ = (a: { z: string; id: string }, b: { z: string; id: string }) => {
  if (a.z === b.z) return a.id < b.id ? -1 : 1;

  return a.z < b.z ? -1 : 1;
};

/** A `z` above everything present: new objects land on top. */
export const topZ = (objects: Iterable<{ z: string }>): string => {
  let highest: string | null = null;

  Array.from(objects).forEach(({ z }) => {
    if (highest === null || z > highest) highest = z;
  });

  return generateKeyBetween(highest, null);
};

export const bottomZ = (objects: Iterable<{ z: string }>): string => {
  let lowest: string | null = null;

  Array.from(objects).forEach(({ z }) => {
    if (lowest === null || z < lowest) lowest = z;
  });

  return generateKeyBetween(null, lowest);
};

/**
 * A `z` that puts `id` one step up or down in the current order without
 * rewriting anyone else's key, which is what fractional indexing is for.
 */
export const zStep = (objects: BoardObject[], id: string, direction: 'up' | 'down'): string | null => {
  const sorted = [...objects].sort(byZ);
  const index = sorted.findIndex((object) => object.id === id);

  if (index === -1) return null;

  if (direction === 'up') {
    const above = sorted[index + 1];
    if (!above) return null;

    const beyond = sorted[index + 2];

    return generateKeyBetween(above.z, beyond ? beyond.z : null);
  }

  const below = sorted[index - 1];
  if (!below) return null;

  const beneath = sorted[index - 2];

  return generateKeyBetween(beneath ? beneath.z : null, below.z);
};
