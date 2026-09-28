export type Viewport = { x: number; y: number; scale: number };

export const toBoard = (screenPos: number, axis: number, scale: number) =>
  (screenPos - axis) / scale;

export const toScreen = (boardPos: number, axis: number, scale: number) =>
  boardPos * scale + axis;
