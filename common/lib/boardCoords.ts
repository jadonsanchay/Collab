import { screenToWorld, worldToScreen } from '@/common/vector/camera';
import { useRoomStore } from '@/common/store/room.store';
import { useVectorStore } from '@/common/store/vector.store';
import { useViewportStore } from '@/common/store/viewport.store';

import { toBoard, toScreen } from './coords';

/**
 * Board ↔ screen conversion for whichever engine the current room uses:
 * the raster viewport transform, or the vector camera. Presence (cursors,
 * follow mode) is shared by both engines and goes through this so it never
 * has to know which board it is on.
 */
export const boardToScreenPoint = (x: number, y: number) => {
  if (useRoomStore.getState().room.engine === 'vector') {
    return worldToScreen({ x, y }, useVectorStore.getState().camera);
  }

  const viewport = useViewportStore.getState();

  return { x: toScreen(x, viewport.x, viewport.scale), y: toScreen(y, viewport.y, viewport.scale) };
};

export const screenToBoardPoint = (x: number, y: number) => {
  if (useRoomStore.getState().room.engine === 'vector') {
    return screenToWorld({ x, y }, useVectorStore.getState().camera);
  }

  const viewport = useViewportStore.getState();

  return { x: toBoard(x, viewport.x, viewport.scale), y: toBoard(y, viewport.y, viewport.scale) };
};

/** Subscribe-able version for rAF loops: which store to watch for view changes. */
export const useBoardView = () => {
  const engine = useRoomStore((state) => state.room.engine);
  const camera = useVectorStore((state) => state.camera);
  const x = useViewportStore((state) => state.x);
  const y = useViewportStore((state) => state.y);
  const scale = useViewportStore((state) => state.scale);

  return engine === 'vector'
    ? { key: `v:${camera.x}:${camera.y}:${camera.zoom}`, toScreen: (bx: number, by: number) => worldToScreen({ x: bx, y: by }, camera) }
    : { key: `r:${x}:${y}:${scale}`, toScreen: (bx: number, by: number) => ({ x: toScreen(bx, x, scale), y: toScreen(by, y, scale) }) };
};
