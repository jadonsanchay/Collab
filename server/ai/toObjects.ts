import { generateKeyBetween } from 'fractional-indexing';

import type { AiKind, BoardRect, Point as WirePoint } from '@/common/types/global';
import { newShape, newSticky, newStroke, newText } from '@/common/vector/objects';
import type { BoardObject, Point } from '@/common/vector/types';

import { DEFAULT_TIMING, normalizeRect, type Timing } from './interpreter';
import { PROGRAM_SPACE, type DrawingProgram, type Primitive, type ProgramPoint } from './schema';

/** One object to place, with the pen path the cursor traces before it appears. */
export type PlannedObject = {
  object: BoardObject;
  cursorPath: WirePoint[];
  durationMs: number;
};

export type ObjectCommon = {
  createdBy: string;
  /** Recorded on every object so "Undo Sketch" can find them. */
  requestId?: string;
  /** The `z` of the first object; each next one sorts above the previous. */
  firstZ: string;
  now?: number;
};

type Mapping = { scale: number; offsetX: number; offsetY: number };

/** Space left between a cleaned-up selection and its redrawn copy. */
const CLEANUP_GAP = 40;

/** Average glyph width as a fraction of the font size, for sizing text boxes. */
const GLYPH_WIDTH = 0.55;

const LINE_HEIGHT = 1.3;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Where a request's output goes on an objects board. The same rules as
 * `placeTarget`, without clamping to a canvas: a vector board has no edges,
 * and the viewport may well have negative coordinates.
 */
export const placeTargetUnbounded = (
  kind: AiKind,
  request: { selection?: BoardRect; viewport: BoardRect },
): BoardRect | null => {
  const viewport = normalizeRect(request.viewport);

  if (kind === 'cleanup') {
    if (!request.selection) return null;

    const selection = normalizeRect(request.selection);

    if (selection.width < 1 || selection.height < 1) return null;

    return {
      x: selection.x + selection.width + CLEANUP_GAP,
      y: selection.y,
      width: selection.width,
      height: selection.height,
    };
  }

  const usable = { width: Math.max(viewport.width, 200), height: Math.max(viewport.height, 200) };

  if (kind === 'draw') {
    const width = usable.width * 0.6;
    const height = usable.height * 0.6;

    return {
      x: viewport.x + (viewport.width - width) / 2,
      y: viewport.y + (viewport.height - height) / 2,
      width,
      height,
    };
  }

  const margin = 24;

  return {
    x: viewport.x + margin,
    y: viewport.y + margin,
    width: clamp(usable.width - margin * 2, 160, 720),
    height: clamp(usable.height - margin * 2, 160, 480),
  };
};

/** Fits the 0 to 1000 program square inside the target, centred in the longer dimension. */
const mappingFor = (target: BoardRect): Mapping => {
  const rect = normalizeRect(target);
  const scale = Math.max(Math.min(rect.width, rect.height) / PROGRAM_SPACE, 0.01);

  return {
    scale,
    offsetX: rect.x + (rect.width - PROGRAM_SPACE * scale) / 2,
    offsetY: rect.y + (rect.height - PROGRAM_SPACE * scale) / 2,
  };
};

const mapPoint = (mapping: Mapping, point: ProgramPoint): Point => ({
  x: mapping.offsetX + point.x * mapping.scale,
  y: mapping.offsetY + point.y * mapping.scale,
});

const mapWidth = (mapping: Mapping, width: number) => clamp(width * mapping.scale, 1, 100);

const tuple = (point: Point): WirePoint => [point.x, point.y];

const cornersOf = (from: Point, to: Point): WirePoint[] => [
  tuple(from),
  [to.x, from.y],
  tuple(to),
  [from.x, to.y],
  tuple(from),
];

const ellipsePath = (from: Point, to: Point): WirePoint[] => {
  const cx = (from.x + to.x) / 2;
  const cy = (from.y + to.y) / 2;
  const rx = Math.abs(to.x - from.x) / 2;
  const ry = Math.abs(to.y - from.y) / 2;

  return Array.from({ length: 13 }, (_, i) => {
    const angle = (i / 12) * Math.PI * 2;

    return [cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)] as WirePoint;
  });
};

const pathLength = (path: WirePoint[]) =>
  path.reduce((sum, [x, y], i) => (i === 0 ? 0 : sum + Math.hypot(x - path[i - 1][0], y - path[i - 1][1])), 0);

const convert = (
  primitive: Primitive,
  mapping: Mapping,
  common: { z: string; createdBy: string; now?: number },
): { object: BoardObject; cursorPath: WirePoint[] } | null => {
  switch (primitive.type) {
    case 'line': {
      const points = primitive.points.map((point) => mapPoint(mapping, point));
      const object = newStroke(
        points.map((point): [number, number, number] => [point.x, point.y, 0.5]),
        { color: primitive.stroke, size: mapWidth(mapping, primitive.width) },
        common,
      );

      return { object, cursorPath: points.map(tuple) };
    }

    case 'rect': {
      const from = mapPoint(mapping, { x: primitive.x, y: primitive.y });
      const to = mapPoint(mapping, { x: primitive.x + primitive.w, y: primitive.y + primitive.h });
      const object = newShape(
        'rect',
        from,
        to,
        { stroke: primitive.stroke, fill: primitive.fill, strokeWidth: mapWidth(mapping, primitive.width) },
        common,
      );

      return { object, cursorPath: cornersOf(from, to) };
    }

    case 'ellipse': {
      const from = mapPoint(mapping, { x: primitive.cx - primitive.rx, y: primitive.cy - primitive.ry });
      const to = mapPoint(mapping, { x: primitive.cx + primitive.rx, y: primitive.cy + primitive.ry });
      const object = newShape(
        'ellipse',
        from,
        to,
        { stroke: primitive.stroke, fill: primitive.fill, strokeWidth: mapWidth(mapping, primitive.width) },
        common,
      );

      return { object, cursorPath: ellipsePath(from, to) };
    }

    case 'arrow': {
      const from = mapPoint(mapping, primitive.from);
      const to = mapPoint(mapping, primitive.to);
      const object = newShape(
        'arrow',
        from,
        to,
        { stroke: primitive.stroke, fill: null, strokeWidth: mapWidth(mapping, primitive.width) },
        common,
      );

      return { object, cursorPath: [tuple(from), tuple(to)] };
    }

    case 'text': {
      const at = mapPoint(mapping, { x: primitive.x, y: primitive.y });
      const fontSize = clamp(Math.round(primitive.size * mapping.scale), 8, 200);
      const lines = primitive.text.split('\n');
      const longest = Math.max(1, ...lines.map((line) => line.length));
      const w = Math.max(40, Math.ceil(longest * fontSize * GLYPH_WIDTH));
      const object: BoardObject = {
        ...newText(at, { color: primitive.color, fontSize }, common),
        text: primitive.text,
        w,
        h: lines.length * fontSize * LINE_HEIGHT,
      };

      return { object, cursorPath: [tuple(at), [at.x + w, at.y]] };
    }

    case 'sticky': {
      const from = mapPoint(mapping, { x: primitive.x, y: primitive.y });
      const to = mapPoint(mapping, { x: primitive.x + primitive.w, y: primitive.y + primitive.h });
      const w = Math.max(40, to.x - from.x);
      const h = Math.max(40, to.y - from.y);
      const object: BoardObject = {
        ...newSticky({ x: from.x + w / 2, y: from.y + h / 2 }, primitive.fill, common),
        x: from.x,
        y: from.y,
        w,
        h,
        text: primitive.text,
        fontSize: clamp(Math.round(h / 9), 12, 36),
      };

      return { object, cursorPath: cornersOf(from, to) };
    }

    default:
      return null;
  }
};

/**
 * The interpreter's second output: the same drawing program as editable
 * objects on a vector board, placed in `target`, each stamped with the
 * request that made it and timed for the pen animation like a move would be.
 */
export const toObjects = (
  program: DrawingProgram,
  target: BoardRect,
  common: ObjectCommon,
  timing: Partial<Timing> = {},
): PlannedObject[] => {
  const mapping = mappingFor(target);
  const { cursorSpeedPxPerS, minMoveMs, maxMoveMs, maxTotalMs } = { ...DEFAULT_TIMING, ...timing };
  const planned: PlannedObject[] = [];
  let z: string | null = null;

  program.primitives.forEach((primitive) => {
    z = z === null ? common.firstZ : generateKeyBetween(z, null);

    const converted = convert(primitive, mapping, { z, createdBy: common.createdBy, now: common.now });

    if (!converted) return;

    const object = common.requestId
      ? { ...converted.object, meta: { requestId: common.requestId } }
      : converted.object;
    const travelMs = (pathLength(converted.cursorPath) / cursorSpeedPxPerS) * 1000;

    planned.push({
      object,
      cursorPath: converted.cursorPath,
      durationMs: clamp(travelMs, minMoveMs, maxMoveMs),
    });
  });

  const total = planned.reduce((sum, item) => sum + item.durationMs, 0);

  if (total > maxTotalMs) {
    const factor = maxTotalMs / total;

    return planned.map((item) => ({ ...item, durationMs: item.durationMs * factor }));
  }

  return planned;
};
