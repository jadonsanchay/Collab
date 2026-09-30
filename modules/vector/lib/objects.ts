import { v4 } from 'uuid';

import { boundsOfPoints } from '@/common/vector/geometry';
import type {
  Anchor,
  BoardObject,
  ConnectorObject,
  FrameObject,
  ImageObject,
  Point,
  ShapeKind,
  ShapeObject,
  StickyObject,
  StrokeObject,
  StrokePoint,
  TextObject,
} from '@/common/vector/types';
import { DEFAULT_FONT_FAMILY, STICKY_SIZE } from '@/common/vector/types';

type Common = { z: string; createdBy: string; now?: number };

const base = (common: Common) => ({
  id: v4(),
  rotation: 0,
  z: common.z,
  createdBy: common.createdBy,
  createdAt: common.now ?? Date.now(),
});

/** A stroke from world-space points; the object's box is their bounds. */
export const newStroke = (
  points: [number, number, number][],
  style: { color: string; size: number },
  common: Common,
): StrokeObject => {
  const bounds = boundsOfPoints(
    points.map(([x, y]) => ({ x, y })),
    style.size / 2,
  );

  return {
    ...base(common),
    type: 'stroke',
    x: bounds.x,
    y: bounds.y,
    w: bounds.w,
    h: bounds.h,
    points: points.map(([x, y, pressure]): StrokePoint => [x - bounds.x, y - bounds.y, pressure]),
    color: style.color,
    size: style.size,
  };
};

/** A shape from a drag; lines and arrows keep their direction through negative sizes. */
export const newShape = (
  kind: ShapeKind,
  from: Point,
  to: Point,
  style: { stroke: string; fill: string | null; strokeWidth: number },
  common: Common,
): ShapeObject => {
  const directional = kind === 'line' || kind === 'arrow';

  return {
    ...base(common),
    type: 'shape',
    kind,
    x: directional ? from.x : Math.min(from.x, to.x),
    y: directional ? from.y : Math.min(from.y, to.y),
    w: directional ? to.x - from.x : Math.abs(to.x - from.x),
    h: directional ? to.y - from.y : Math.abs(to.y - from.y),
    stroke: style.stroke,
    fill: style.fill,
    strokeWidth: style.strokeWidth,
    text: '',
  };
};

export const newText = (
  at: Point,
  style: { color: string; fontSize: number },
  common: Common,
): TextObject => ({
  ...base(common),
  type: 'text',
  x: at.x,
  y: at.y,
  w: 240,
  h: style.fontSize * 1.3,
  text: '',
  fontSize: style.fontSize,
  fontFamily: DEFAULT_FONT_FAMILY,
  align: 'left',
  color: style.color,
});

export const newSticky = (at: Point, fill: string, common: Common): StickyObject => ({
  ...base(common),
  type: 'sticky',
  x: at.x - STICKY_SIZE / 2,
  y: at.y - STICKY_SIZE / 2,
  w: STICKY_SIZE,
  h: STICKY_SIZE,
  text: '',
  fill,
  fontSize: 18,
});

export const newImage = (
  at: Point,
  image: { url: string; width: number; height: number },
  common: Common,
): ImageObject => ({
  ...base(common),
  type: 'image',
  x: at.x,
  y: at.y,
  w: image.width,
  h: image.height,
  url: image.url,
  naturalW: image.width,
  naturalH: image.height,
});

export const newFrame = (from: Point, to: Point, common: Common): FrameObject => ({
  ...base(common),
  type: 'frame',
  x: Math.min(from.x, to.x),
  y: Math.min(from.y, to.y),
  w: Math.abs(to.x - from.x),
  h: Math.abs(to.y - from.y),
  title: 'Frame',
});

export const newConnector = (
  from: Anchor,
  to: Anchor,
  style: { stroke: string; strokeWidth: number },
  common: Common,
): ConnectorObject => ({
  ...base(common),
  type: 'connector',
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  from,
  to,
  style: 'straight',
  arrowEnd: true,
  stroke: style.stroke,
  strokeWidth: style.strokeWidth,
  label: '',
});

/** Objects fully inside a frame become its children and move with it. */
export const childrenOf = (frame: FrameObject, objects: BoardObject[]) =>
  objects.filter(
    (object) =>
      object.id !== frame.id &&
      object.type !== 'frame' &&
      object.type !== 'connector' &&
      object.x >= frame.x &&
      object.y >= frame.y &&
      object.x + object.w <= frame.x + frame.w &&
      object.y + object.h <= frame.y + frame.h,
  );

/** A copy offset a little, with a fresh id, for duplicate. */
export const duplicateObject = (object: BoardObject, z: string, offset = 20): BoardObject => ({
  ...object,
  id: v4(),
  x: object.x + offset,
  y: object.y + offset,
  z,
  createdAt: Date.now(),
});
