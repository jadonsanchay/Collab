import { generateKeyBetween } from 'fractional-indexing';
import { v4 } from 'uuid';

import type { Move } from '@/common/types/global';
import { newShape, newStroke, newText } from '@/common/vector/objects';
import type { BoardObject, ImageObject } from '@/common/vector/types';

/** Average glyph width as a fraction of the font size, for sizing text boxes. */
const GLYPH_WIDTH = 0.55;

const LINE_HEIGHT = 1.3;

const rgba = ({ r, g, b, a }: Move['options']['lineColor']) => `rgba(${r}, ${g}, ${b}, ${a})`;

const isKeepable = (move: Move) => move.options.mode !== 'select' && move.path.length > 0;

const isOverlay = (move: Move) => move.options.shape === 'text' || move.options.shape === 'image';

export type UpgradePlan =
  /** Every move maps to an object of its own. */
  | { strategy: 'objects'; moves: Move[] }
  /**
   * The board used the pixel eraser, which has no object equivalent. The
   * moves it touched flatten to one picture; text and images placed after
   * the last erase stay editable objects on top of it.
   */
  | { strategy: 'image'; flattened: Move[]; after: Move[] };

/** Decides how a raster board becomes objects; see `UpgradePlan`. */
export const planUpgrade = (all: Move[]): UpgradePlan => {
  const moves = [...all].filter(isKeepable).sort((a, b) => a.seq - b.seq);
  const lastEraser = moves.reduce((last, move) => (move.options.mode === 'eraser' ? move.seq : last), -1);

  if (lastEraser < 0) return { strategy: 'objects', moves };

  return {
    strategy: 'image',
    flattened: moves.filter((move) => move.seq <= lastEraser || !isOverlay(move)),
    after: moves.filter((move) => move.seq > lastEraser && isOverlay(move)),
  };
};

type ConvertOptions = { firstZ?: string; now?: number };

const convert = (move: Move, common: { z: string; createdBy: string; now?: number }): BoardObject | null => {
  const { options, path } = move;
  const [x, y] = path[0];
  const stroke = rgba(options.lineColor);
  const fill = options.fillColor.a > 0 ? rgba(options.fillColor) : null;

  switch (options.shape) {
    case 'line':
      return newStroke(
        path.map(([px, py]): [number, number, number] => [px, py, 0.5]),
        { color: stroke, size: options.lineWidth },
        common,
      );

    case 'rect':
      return newShape(
        'rect',
        { x, y },
        { x: x + move.rect.width, y: y + move.rect.height },
        { stroke, fill, strokeWidth: options.lineWidth },
        common,
      );

    case 'circle': {
      const { cX, cY, radiusX, radiusY } = move.circle;

      return newShape(
        'ellipse',
        { x: cX - radiusX, y: cY - radiusY },
        { x: cX + radiusX, y: cY + radiusY },
        { stroke, fill, strokeWidth: options.lineWidth },
        common,
      );
    }

    case 'text': {
      if (!move.text) return null;

      const { content, fontSize } = move.text;
      const lines = content.split('\n');
      const longest = Math.max(1, ...lines.map((line) => line.length));

      return {
        ...newText({ x, y }, { color: stroke, fontSize }, common),
        text: content,
        w: Math.max(40, Math.ceil(longest * fontSize * GLYPH_WIDTH)),
        h: lines.length * fontSize * LINE_HEIGHT,
      };
    }

    case 'image': {
      const url = move.img.url || move.img.base64;
      if (!url) return null;

      const w = move.img.width ?? 400;
      const h = move.img.height ?? 300;
      const image: ImageObject = {
        id: v4(),
        type: 'image',
        x,
        y,
        w,
        h,
        rotation: 0,
        z: common.z,
        createdBy: common.createdBy,
        createdAt: common.now ?? Date.now(),
        url,
        naturalW: w,
        naturalH: h,
      };

      return image;
    }

    default:
      return null;
  }
};

/**
 * Raster moves as vector objects, in drawing order, each marked as coming
 * from the upgrade. Eraser moves are not convertible and are skipped here;
 * `planUpgrade` decides whether that loses anything.
 */
export const movesToObjects = (moves: Move[], createdBy: string, options: ConvertOptions = {}): BoardObject[] => {
  const objects: BoardObject[] = [];
  let z: string | null = null;

  [...moves]
    .filter((move) => isKeepable(move) && move.options.mode !== 'eraser')
    .sort((a, b) => a.seq - b.seq)
    .forEach((move) => {
      z = z === null ? (options.firstZ ?? 'a0') : generateKeyBetween(z, null);

      const object = convert(move, { z, createdBy: move.userId || createdBy, now: options.now });

      if (object) objects.push({ ...object, meta: { legacy: true } });
    });

  return objects;
};
