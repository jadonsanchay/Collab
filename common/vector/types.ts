/**
 * The vector object model (Phase 4). Every object has a bounding box in
 * world coordinates (`x`, `y`, `w`, `h`), a rotation in degrees around the
 * box centre, a fractional-index `z` for ordering, and an author. Text
 * fields are `Y.Text` in the document and plain strings here, where the
 * renderer and the tools read them.
 */
export type ObjectType = 'stroke' | 'shape' | 'text' | 'sticky' | 'image' | 'connector' | 'frame';

export interface BaseObject {
  id: string;
  type: ObjectType;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  z: string;
  createdBy: string;
  createdAt: number;
  locked?: boolean;
  /** A frame this object belongs to; it moves with the frame. */
  parentId?: string;
  meta?: {
    /** The AI request that produced it, for "Undo Sketch". */
    requestId?: string;
    /** Produced by upgrading a raster board. */
    legacy?: boolean;
  };
}

/** Points are `[x, y, pressure]` relative to the object's `x`, `y`. */
export type StrokePoint = [number, number, number];

export interface StrokeObject extends BaseObject {
  type: 'stroke';
  points: StrokePoint[];
  color: string;
  size: number;
}

export type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'diamond' | 'line' | 'arrow';

export interface ShapeObject extends BaseObject {
  type: 'shape';
  kind: ShapeKind;
  stroke: string;
  fill: string | null;
  strokeWidth: number;
  /** Optional label centred in the shape. */
  text: string;
}

export type TextAlign = 'left' | 'center' | 'right';

export interface TextObject extends BaseObject {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  align: TextAlign;
  color: string;
}

export interface StickyObject extends BaseObject {
  type: 'sticky';
  text: string;
  fill: string;
  fontSize: number;
}

export interface ImageObject extends BaseObject {
  type: 'image';
  url: string;
  naturalW: number;
  naturalH: number;
}

export type AnchorSide = 'top' | 'right' | 'bottom' | 'left' | 'center';

export type Anchor = { objectId: string; side: AnchorSide } | { x: number; y: number };

export type ConnectorStyle = 'straight' | 'elbow' | 'curved';

export interface ConnectorObject extends BaseObject {
  type: 'connector';
  from: Anchor;
  to: Anchor;
  style: ConnectorStyle;
  arrowEnd: boolean;
  stroke: string;
  strokeWidth: number;
  label: string;
}

export interface FrameObject extends BaseObject {
  type: 'frame';
  title: string;
}

export type BoardObject =
  | StrokeObject
  | ShapeObject
  | TextObject
  | StickyObject
  | ImageObject
  | ConnectorObject
  | FrameObject;

/** Fields kept as `Y.Text` in the document, by object type. */
export const TEXT_FIELDS: Partial<Record<ObjectType, string[]>> = {
  shape: ['text'],
  text: ['text'],
  sticky: ['text'],
  connector: ['label'],
  frame: ['title'],
};

export type Rect = { x: number; y: number; w: number; h: number };

export type Point = { x: number; y: number };

export const DEFAULT_FONT_FAMILY = 'Montserrat, sans-serif';

/** Reasonable defaults for objects made by the tools. */
export const STICKY_SIZE = 200;
export const STICKY_FILLS = ['#FEF08A', '#BBF7D0', '#BFDBFE', '#FBCFE8', '#FED7AA', '#DDD6FE'];
