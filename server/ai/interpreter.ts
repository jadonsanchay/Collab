import { v4 } from 'uuid';

import { CANVAS_SIZE } from '@/common/constants/canvasSize';
import {
  drawPayloadSchema,
  MAX_FONT_SIZE,
  MAX_LINE_WIDTH,
} from '@/common/schemas/move';
import type {
  AiKind,
  BoardRect,
  CtxOptions,
  DrawPayload,
  Point,
} from '@/common/types/global';

import {
  PROGRAM_SPACE,
  type DrawingProgram,
  type Primitive,
  type ProgramPoint,
} from './schema';

/** A move Sketch will make, with the pen path its cursor follows first. */
export type PlannedMove = {
  payload: DrawPayload;
  cursorPath: Point[];
  durationMs: number;
};

export type Timing = {
  /** How fast the cursor travels along a path. */
  cursorSpeedPxPerS: number;
  minMoveMs: number;
  maxMoveMs: number;
  /** If the whole program would take longer, every move is shortened pro rata. */
  maxTotalMs: number;
};

export const DEFAULT_TIMING: Timing = {
  cursorSpeedPxPerS: 900,
  minMoveMs: 150,
  maxMoveMs: 1200,
  maxTotalMs: 12_000,
};

type Board = { width: number; height: number };

type Mapping = {
  scale: number;
  offsetX: number;
  offsetY: number;
  board: Board;
};

type Rgba = { r: number; g: number; b: number; a: number };

const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };
const STICKY_INK = '#222222';
/** Average glyph width as a fraction of font size, close enough for layout. */
const GLYPH_WIDTH = 0.55;
const LINE_HEIGHT = 1.25;
/** Gap between a cleaned-up selection and its redrawn copy. */
const CLEANUP_GAP = 40;

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

export const hexToRgba = (hex: string, alpha = 1): Rgba => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
  a: alpha,
});

/** Same rectangle with a non-negative size and its origin at the top-left. */
export const normalizeRect = (rect: BoardRect): BoardRect => ({
  x: Math.min(rect.x, rect.x + rect.width),
  y: Math.min(rect.y, rect.y + rect.height),
  width: Math.abs(rect.width),
  height: Math.abs(rect.height),
});

const intersectBoard = (rect: BoardRect, board: Board): BoardRect => {
  const normalized = normalizeRect(rect);
  const x = clamp(normalized.x, 0, board.width);
  const y = clamp(normalized.y, 0, board.height);

  return {
    x,
    y,
    width: clamp(normalized.x + normalized.width, 0, board.width) - x,
    height: clamp(normalized.y + normalized.height, 0, board.height) - y,
  };
};

/**
 * Where a request's output goes on the board.
 *
 * `cleanup` redraws beside the selection so the original stays for
 * comparison; `draw` fills the middle 60 percent of what the requester sees;
 * `summarize` stacks stickies from the viewport's top-left. Null when the
 * kind needs a selection and none was given.
 */
export const placeTarget = (
  kind: AiKind,
  request: { selection?: BoardRect; viewport: BoardRect },
  board: Board = CANVAS_SIZE,
): BoardRect | null => {
  const viewport = intersectBoard(request.viewport, board);

  if (kind === 'cleanup') {
    if (!request.selection) return null;

    const selection = intersectBoard(request.selection, board);

    if (selection.width < 1 || selection.height < 1) return null;

    const x = clamp(
      selection.x + selection.width + CLEANUP_GAP,
      0,
      Math.max(0, board.width - selection.width),
    );
    const y = clamp(selection.y, 0, Math.max(0, board.height - selection.height));

    return { x, y, width: selection.width, height: selection.height };
  }

  const usable = {
    width: Math.max(viewport.width, 200),
    height: Math.max(viewport.height, 200),
  };

  if (kind === 'draw') {
    const width = usable.width * 0.6;
    const height = usable.height * 0.6;

    return {
      x: clamp(viewport.x + (viewport.width - width) / 2, 0, board.width - width),
      y: clamp(viewport.y + (viewport.height - height) / 2, 0, board.height - height),
      width,
      height,
    };
  }

  const margin = 24;
  const width = clamp(usable.width - margin * 2, 160, 720);
  const height = clamp(usable.height - margin * 2, 160, 480);

  return {
    x: clamp(viewport.x + margin, 0, board.width - width),
    y: clamp(viewport.y + margin, 0, board.height - height),
    width,
    height,
  };
};

/**
 * Fits the 0 to 1000 program square inside the target, preserving aspect
 * ratio and centring the square in the longer dimension.
 */
const createMapping = (target: BoardRect, board: Board): Mapping => {
  const rect = normalizeRect(target);
  const scale = Math.max(Math.min(rect.width, rect.height) / PROGRAM_SPACE, 0.01);

  return {
    scale,
    offsetX: rect.x + (rect.width - PROGRAM_SPACE * scale) / 2,
    offsetY: rect.y + (rect.height - PROGRAM_SPACE * scale) / 2,
    board,
  };
};

const mapPoint = (mapping: Mapping, point: ProgramPoint): Point => [
  clamp(mapping.offsetX + point.x * mapping.scale, 0, mapping.board.width),
  clamp(mapping.offsetY + point.y * mapping.scale, 0, mapping.board.height),
];

const mapWidth = (mapping: Mapping, width: number) =>
  clamp(Math.round(width * mapping.scale), 1, MAX_LINE_WIDTH);

const mapFontSize = (mapping: Mapping, size: number) =>
  clamp(Math.round(size * mapping.scale), 8, MAX_FONT_SIZE);

const options = (
  shape: CtxOptions['shape'],
  stroke: Rgba,
  fill: Rgba,
  lineWidth: number,
): CtxOptions => ({
  shape,
  mode: 'draw',
  lineWidth,
  lineColor: stroke,
  fillColor: fill,
  selection: null,
});

type Draft = {
  path: Point[];
  options: CtxOptions;
  rect?: { width: number; height: number };
  circle?: { cX: number; cY: number; radiusX: number; radiusY: number };
  text?: { content: string; fontSize: number };
  cursorPath: Point[];
};

const pathLength = (path: Point[]) =>
  path.reduce((total, point, index) => {
    if (index === 0) return 0;

    const [px, py] = path[index - 1];

    return total + Math.hypot(point[0] - px, point[1] - py);
  }, 0);

/** Greedy word wrap; words longer than a line are broken. */
export const wrapText = (text: string, maxChars: number): string[] => {
  const limit = Math.max(1, Math.floor(maxChars));
  const lines: string[] = [];
  let current = '';

  const pushWord = (word: string) => {
    if (word.length > limit) {
      if (current) lines.push(current);
      current = '';

      for (let i = 0; i < word.length; i += limit) {
        lines.push(word.slice(i, i + limit));
      }

      return;
    }

    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= limit) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  };

  text
    .split(/\s+/u)
    .filter(Boolean)
    .forEach(pushWord);

  if (current) lines.push(current);

  return lines;
};

const ellipsePerimeter = (
  cX: number,
  cY: number,
  radiusX: number,
  radiusY: number,
): Point[] => {
  const steps = 24;

  return Array.from({ length: steps + 1 }, (_, i) => {
    const angle = (i / steps) * Math.PI * 2;

    return [cX + Math.cos(angle) * radiusX, cY + Math.sin(angle) * radiusY];
  });
};

const textDraft = (
  mapping: Mapping,
  rawAnchor: Point,
  content: string,
  fontSize: number,
  color: Rgba,
): Draft => {
  const anchor: Point = [
    clamp(rawAnchor[0], 0, mapping.board.width),
    clamp(rawAnchor[1], 0, mapping.board.height),
  ];
  const longest = Math.max(...content.split('\n').map((line) => line.length), 1);
  const width = clamp(
    longest * fontSize * GLYPH_WIDTH,
    0,
    mapping.board.width - anchor[0],
  );

  return {
    path: [anchor],
    options: options('text', color, TRANSPARENT, 1),
    text: { content, fontSize },
    cursorPath: [anchor, [anchor[0] + width, anchor[1]]],
  };
};

const draftsFor = (mapping: Mapping, primitive: Primitive): Draft[] => {
  switch (primitive.type) {
    case 'line': {
      const path = primitive.points.map((point) => mapPoint(mapping, point));

      return [
        {
          path,
          options: options(
            'line',
            hexToRgba(primitive.stroke),
            TRANSPARENT,
            mapWidth(mapping, primitive.width),
          ),
          cursorPath: path,
        },
      ];
    }

    case 'rect': {
      const [x1, y1] = mapPoint(mapping, { x: primitive.x, y: primitive.y });
      const [x2, y2] = mapPoint(mapping, {
        x: primitive.x + primitive.w,
        y: primitive.y + primitive.h,
      });

      return [
        {
          path: [[x1, y1]],
          rect: { width: x2 - x1, height: y2 - y1 },
          options: options(
            'rect',
            hexToRgba(primitive.stroke),
            primitive.fill ? hexToRgba(primitive.fill) : TRANSPARENT,
            mapWidth(mapping, primitive.width),
          ),
          cursorPath: [
            [x1, y1],
            [x2, y1],
            [x2, y2],
            [x1, y2],
            [x1, y1],
          ],
        },
      ];
    }

    case 'ellipse': {
      const [cX, cY] = mapPoint(mapping, { x: primitive.cx, y: primitive.cy });
      // Radii shrink so the ellipse stays on the board once its centre is clamped.
      const radiusX = clamp(
        primitive.rx * mapping.scale,
        0,
        Math.min(cX, mapping.board.width - cX),
      );
      const radiusY = clamp(
        primitive.ry * mapping.scale,
        0,
        Math.min(cY, mapping.board.height - cY),
      );

      return [
        {
          path: [[cX, cY]],
          circle: { cX, cY, radiusX, radiusY },
          options: options(
            'circle',
            hexToRgba(primitive.stroke),
            primitive.fill ? hexToRgba(primitive.fill) : TRANSPARENT,
            mapWidth(mapping, primitive.width),
          ),
          cursorPath: ellipsePerimeter(cX, cY, radiusX, radiusY),
        },
      ];
    }

    case 'arrow': {
      const from = mapPoint(mapping, primitive.from);
      const to = mapPoint(mapping, primitive.to);
      const lineWidth = mapWidth(mapping, primitive.width);
      const stroke = hexToRgba(primitive.stroke);
      const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
      const headLength = clamp(4 * lineWidth + 8, 8, 40);
      const spread = (150 * Math.PI) / 180;

      const wing = (direction: number): Point => [
        clamp(to[0] + Math.cos(angle + direction) * headLength, 0, mapping.board.width),
        clamp(to[1] + Math.sin(angle + direction) * headLength, 0, mapping.board.height),
      ];

      const head: Point[] = [wing(spread), to, wing(-spread)];

      return [
        {
          path: [from, to],
          options: options('line', stroke, TRANSPARENT, lineWidth),
          cursorPath: [from, to],
        },
        {
          path: head,
          options: options('line', stroke, TRANSPARENT, lineWidth),
          cursorPath: head,
        },
      ];
    }

    case 'text': {
      const anchor = mapPoint(mapping, { x: primitive.x, y: primitive.y });

      return [
        textDraft(
          mapping,
          anchor,
          primitive.text,
          mapFontSize(mapping, primitive.size),
          hexToRgba(primitive.color),
        ),
      ];
    }

    case 'sticky': {
      const [x1, y1] = mapPoint(mapping, { x: primitive.x, y: primitive.y });
      const [x2, y2] = mapPoint(mapping, {
        x: primitive.x + primitive.w,
        y: primitive.y + primitive.h,
      });
      const width = x2 - x1;
      const height = y2 - y1;
      const fill = hexToRgba(primitive.fill);

      const fontSize = clamp(Math.round(Math.min(width, height) * 0.12), 10, 48);
      const padding = Math.round(fontSize * 0.6);
      const maxChars = Math.max(1, Math.floor((width - padding * 2) / (fontSize * GLYPH_WIDTH)));
      const maxLines = Math.max(1, Math.floor((height - padding * 2) / (fontSize * LINE_HEIGHT)));
      const content = wrapText(primitive.text, maxChars).slice(0, maxLines).join('\n');

      const drafts: Draft[] = [
        {
          path: [[x1, y1]],
          rect: { width, height },
          options: options('rect', fill, fill, 1),
          cursorPath: [
            [x1, y1],
            [x2, y1],
            [x2, y2],
            [x1, y2],
            [x1, y1],
          ],
        },
      ];

      if (content) {
        drafts.push(
          textDraft(
            mapping,
            [x1 + padding, y1 + padding],
            content,
            fontSize,
            hexToRgba(STICKY_INK),
          ),
        );
      }

      return drafts;
    }

    default:
      return [];
  }
};

const toPayload = (draft: Draft): DrawPayload | null => {
  const parsed = drawPayloadSchema.safeParse({
    clientId: v4(),
    path: draft.path,
    options: draft.options,
    rect: draft.rect ?? { width: 0, height: 0 },
    circle: draft.circle ?? { cX: 0, cY: 0, radiusX: 0, radiusY: 0 },
    img: { base64: '' },
    ...(draft.text ? { text: draft.text } : {}),
  });

  return parsed.success ? parsed.data : null;
};

/**
 * Turns a drawing program into the moves Sketch will make, in order, each
 * with a cursor path and a duration. Coordinates are scaled into `target`
 * and clamped to the board; every payload is re-validated with the same
 * schema the server applies to human moves, so nothing the model says can
 * put an invalid move in the room.
 */
export const interpret = (
  program: DrawingProgram,
  target: BoardRect,
  board: Board = CANVAS_SIZE,
  timing: Partial<Timing> = {},
): PlannedMove[] => {
  const mapping = createMapping(target, board);
  const { cursorSpeedPxPerS, minMoveMs, maxMoveMs, maxTotalMs } = {
    ...DEFAULT_TIMING,
    ...timing,
  };

  const planned: PlannedMove[] = [];

  program.primitives.forEach((primitive) => {
    draftsFor(mapping, primitive).forEach((draft) => {
      const payload = toPayload(draft);

      if (!payload) return;

      const travelMs = (pathLength(draft.cursorPath) / cursorSpeedPxPerS) * 1000;

      planned.push({
        payload,
        cursorPath: draft.cursorPath,
        durationMs: clamp(travelMs, minMoveMs, maxMoveMs),
      });
    });
  });

  const total = planned.reduce((sum, move) => sum + move.durationMs, 0);

  if (total > maxTotalMs) {
    const factor = maxTotalMs / total;

    return planned.map((move) => ({
      ...move,
      durationMs: move.durationMs * factor,
    }));
  }

  return planned;
};
