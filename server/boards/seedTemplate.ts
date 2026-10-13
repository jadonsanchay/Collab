import type { BoardEngine } from '@/common/types/global';
import { createObject } from '@/common/vector/doc';

import { toObjects } from '../ai/toObjects';
import type { VectorDocStore } from '../vector/docStore';
import type { BoardStore } from './BoardStore';
import { type Template, templateMoves } from './templates';

/**
 * Where a template lands on a new objects board: inside what the default
 * camera shows, so the board does not open onto blank space.
 */
export const VECTOR_TEMPLATE_TARGET = { x: 0, y: 0, width: 1400, height: 900 };

/**
 * Puts a template's content on a freshly created board. The same drawing
 * program seeds either engine: moves on a drawing board, objects in the
 * document of an objects board. Shared by the dashboard route and the
 * landing page's `create_room`.
 */
export const seedTemplate = async ({
  boards,
  vectorDocs,
  roomId,
  userId,
  template,
  engine,
}: {
  boards: BoardStore;
  vectorDocs: VectorDocStore;
  roomId: string;
  userId: string;
  template: Template;
  engine: BoardEngine;
}) => {
  if (!template.program.primitives.length) return;

  if (engine === 'raster') {
    templateMoves(template).forEach((payload) => boards.addMove(roomId, userId, payload));
    return;
  }

  const entry = await vectorDocs.open(roomId);
  const planned = toObjects(template.program, VECTOR_TEMPLATE_TARGET, { createdBy: userId, firstZ: 'a0' });

  entry.doc.transact(() => {
    planned.forEach(({ object }) => createObject(entry.doc, object));
  }, { userId });
  vectorDocs.release(roomId);
};
