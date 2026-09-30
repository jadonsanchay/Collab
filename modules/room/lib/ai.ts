import { v4 } from 'uuid';

import { socket } from '@/common/lib/socket';
import { useAiStore } from '@/common/store/ai.store';
import { useRoomStore } from '@/common/store/room.store';
import { useVectorStore } from '@/common/store/vector.store';
import { useViewportStore } from '@/common/store/viewport.store';
import type { AiKind, AiRequest, BoardRect } from '@/common/types/global';
import { visibleWorld } from '@/common/vector/camera';

/**
 * The board rectangle currently on screen: from the viewport transform on a
 * raster board, from the camera on a vector one. Sketch draws inside it.
 */
export const currentViewportRect = (): BoardRect => {
  const width = typeof window === 'undefined' ? 0 : window.innerWidth;
  const height = typeof window === 'undefined' ? 0 : window.innerHeight;

  if (useRoomStore.getState().room.engine === 'vector') {
    const world = visibleWorld(useVectorStore.getState().camera, { width, height });

    return { x: world.x, y: world.y, width: world.w, height: world.h };
  }

  const { x, y, scale } = useViewportStore.getState();

  return { x: -x / scale, y: -y / scale, width: width / scale, height: height / scale };
};

/**
 * Sends one request to Sketch and returns its id. The id is remembered as
 * ours before the emit, so the very first status update already knows whose
 * toast it is.
 */
export const requestSketch = (
  kind: AiKind,
  extra: { prompt?: string; selection?: BoardRect; image?: string } = {},
): string => {
  const requestId = v4();

  useAiStore.getState().markMine(requestId);

  const request: AiRequest = { requestId, kind, viewport: currentViewportRect() };

  // Only present keys go on the wire: the schema accepts absent, not null.
  if (extra.prompt) request.prompt = extra.prompt;
  if (extra.selection) request.selection = extra.selection;
  if (extra.image) request.image = extra.image;

  socket.emit('ai_request', request);

  return requestId;
};

export const undoSketch = (requestId: string) => {
  socket.emit('ai_undo', requestId);
};

const MENTION = /^@sketch\b[\s:,]*/iu;

/**
 * The prompt after an `@sketch` mention, or null when the message is not
 * one. The message itself is still sent to chat: the room should see what
 * was asked.
 */
export const parseSketchMention = (message: string): string | null => {
  const trimmed = message.trim();
  const match = MENTION.exec(trimmed);

  if (!match) return null;

  return trimmed.slice(match[0].length).trim();
};
