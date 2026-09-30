import { getStroke } from 'perfect-freehand';

import { connectorPoints, objectBounds } from '@/common/render/vector/Renderer';
import { fontFor, LINE_HEIGHT, wrapLines } from '@/common/render/vector/text';
import { unionRect } from '@/common/vector/geometry';
import { byZ } from '@/common/vector/order';
import type {
  BoardObject,
  ConnectorObject,
  FrameObject,
  ImageObject,
  Point,
  Rect,
  ShapeObject,
  StickyObject,
  StrokeObject,
  TextObject,
} from '@/common/vector/types';
import { DEFAULT_FONT_FAMILY } from '@/common/vector/types';

/** Splits text into lines that fit a width at a font size. */
export type Wrap = (text: string, fontSize: number, maxWidth: number, family?: string) => string[];

export type SvgOptions = {
  wrap?: Wrap;
  /** Space around the content, in world units. */
  padding?: number;
};

const escape = (value: string) =>
  value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');

const num = (value: number) => String(Number(value.toFixed(2)));

/** Measures with a canvas when there is a DOM, else breaks on newlines only. */
export const defaultWrap = (): Wrap => {
  const ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');

  return (text, fontSize, maxWidth, family) => {
    if (!ctx) return text.split('\n');

    ctx.font = fontFor(fontSize, family);

    return wrapLines(ctx, text, maxWidth);
  };
};

const rotationOf = (object: Rect & { rotation: number }) =>
  object.rotation
    ? ` transform="rotate(${num(object.rotation)} ${num(object.x + object.w / 2)} ${num(object.y + object.h / 2)})"`
    : '';

const lines = (
  text: string[],
  x: number,
  y: number,
  fontSize: number,
  fill: string,
  anchor: 'start' | 'middle' | 'end',
  family = DEFAULT_FONT_FAMILY,
) =>
  text
    .map(
      (line, index) =>
        `<text x="${num(x)}" y="${num(y + index * fontSize * LINE_HEIGHT)}" font-size="${num(fontSize)}" font-family="${escape(family)}" fill="${escape(fill)}" text-anchor="${anchor}" dominant-baseline="hanging">${escape(line)}</text>`,
    )
    .join('');

const arrowHead = (from: Point, to: Point, size: number, stroke: string, width: number) => {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const spread = Math.PI / 7;
  const a = { x: to.x - size * Math.cos(angle - spread), y: to.y - size * Math.sin(angle - spread) };
  const b = { x: to.x - size * Math.cos(angle + spread), y: to.y - size * Math.sin(angle + spread) };

  return `<path d="M ${num(a.x)} ${num(a.y)} L ${num(to.x)} ${num(to.y)} L ${num(b.x)} ${num(b.y)}" fill="none" stroke="${escape(stroke)}" stroke-width="${num(width)}" stroke-linecap="round" stroke-linejoin="round"/>`;
};

const strokeSvg = (stroke: StrokeObject) => {
  const hasPressure = stroke.points.some(([, , pressure]) => pressure > 0 && pressure !== 0.5);
  const outline = getStroke(stroke.points, {
    size: stroke.size,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.4,
    simulatePressure: !hasPressure,
    last: true,
  });

  if (!outline.length) return '';

  const d = outline.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${num(x)} ${num(y)}`).join(' ');

  return `<g transform="translate(${num(stroke.x)} ${num(stroke.y)})"${rotationOf({ ...stroke, x: 0, y: 0 })}><path d="${d} Z" fill="${escape(stroke.color)}"/></g>`;
};

const shapeSvg = (shape: ShapeObject, wrap: Wrap) => {
  const { w, h } = shape;
  const common = `fill="${shape.fill && shape.kind !== 'line' && shape.kind !== 'arrow' ? escape(shape.fill) : 'none'}" stroke="${escape(shape.stroke)}" stroke-width="${num(shape.strokeWidth)}" stroke-linejoin="round" stroke-linecap="round"`;
  let body: string;

  switch (shape.kind) {
    case 'ellipse':
      body = `<ellipse cx="${num(w / 2)}" cy="${num(h / 2)}" rx="${num(Math.abs(w) / 2)}" ry="${num(Math.abs(h) / 2)}" ${common}/>`;
      break;
    case 'triangle':
      body = `<polygon points="${num(w / 2)},0 ${num(w)},${num(h)} 0,${num(h)}" ${common}/>`;
      break;
    case 'diamond':
      body = `<polygon points="${num(w / 2)},0 ${num(w)},${num(h / 2)} ${num(w / 2)},${num(h)} 0,${num(h / 2)}" ${common}/>`;
      break;
    case 'line':
    case 'arrow':
      body = `<line x1="0" y1="0" x2="${num(w)}" y2="${num(h)}" ${common}/>`;
      if (shape.kind === 'arrow') {
        body += arrowHead({ x: 0, y: 0 }, { x: w, y: h }, Math.max(10, shape.strokeWidth * 4), shape.stroke, shape.strokeWidth);
      }
      break;
    default:
      body = `<rect x="0" y="0" width="${num(Math.abs(w))}" height="${num(Math.abs(h))}" ${common}/>`;
  }

  if (shape.text) {
    const fontSize = Math.max(10, Math.min(28, h / 5));
    const wrapped = wrap(shape.text, fontSize, Math.max(10, w - 16));
    const y = Math.max(4, (h - wrapped.length * fontSize * LINE_HEIGHT) / 2);

    body += lines(wrapped, w / 2, y, fontSize, shape.stroke, 'middle');
  }

  return `<g transform="translate(${num(shape.x)} ${num(shape.y)})"${rotationOf({ ...shape, x: 0, y: 0 })}>${body}</g>`;
};

const textSvg = (text: TextObject, wrap: Wrap) => {
  const anchors = { left: 'start', center: 'middle', right: 'end' } as const;
  const offsets = { left: 0, center: text.w / 2, right: text.w };

  return `<g transform="translate(${num(text.x)} ${num(text.y)})"${rotationOf({ ...text, x: 0, y: 0 })}>${lines(
    wrap(text.text, text.fontSize, Math.max(10, text.w), text.fontFamily),
    offsets[text.align],
    0,
    text.fontSize,
    text.color,
    anchors[text.align],
    text.fontFamily,
  )}</g>`;
};

const stickySvg = (sticky: StickyObject, wrap: Wrap) => {
  const padding = 14;
  const wrapped = wrap(sticky.text, sticky.fontSize, Math.max(10, sticky.w - padding * 2));
  const visible = wrapped.filter((_, index) => padding + (index + 1) * sticky.fontSize <= sticky.h - padding);

  return `<g transform="translate(${num(sticky.x)} ${num(sticky.y)})"${rotationOf({ ...sticky, x: 0, y: 0 })}><rect x="0" y="0" width="${num(sticky.w)}" height="${num(sticky.h)}" fill="${escape(sticky.fill)}"/>${lines(visible, padding, padding, sticky.fontSize, '#1F2937', 'start')}</g>`;
};

const imageSvg = (image: ImageObject) =>
  `<image href="${escape(image.url)}" x="${num(image.x)}" y="${num(image.y)}" width="${num(image.w)}" height="${num(image.h)}" preserveAspectRatio="none"${rotationOf(image)}/>`;

const connectorSvg = (connector: ConnectorObject, objects: Map<string, BoardObject>) => {
  const points = connectorPoints(connector, objects);
  if (!points) return '';

  const style = `fill="none" stroke="${escape(connector.stroke)}" stroke-width="${num(connector.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"`;
  let body: string;

  if (connector.style === 'curved' && points.length === 2) {
    const [from, to] = points;
    const dx = (to.x - from.x) / 2;

    body = `<path d="M ${num(from.x)} ${num(from.y)} C ${num(from.x + dx)} ${num(from.y)} ${num(to.x - dx)} ${num(to.y)} ${num(to.x)} ${num(to.y)}" ${style}/>`;
  } else {
    body = `<polyline points="${points.map((point) => `${num(point.x)},${num(point.y)}`).join(' ')}" ${style}/>`;
  }

  if (connector.arrowEnd) {
    body += arrowHead(
      points[points.length - 2],
      points[points.length - 1],
      Math.max(10, connector.strokeWidth * 4),
      connector.stroke,
      connector.strokeWidth,
    );
  }

  if (connector.label) {
    const mid = points[Math.floor((points.length - 1) / 2)];
    const next = points[Math.ceil((points.length - 1) / 2)];
    const at = { x: (mid.x + next.x) / 2, y: (mid.y + next.y) / 2 };
    const width = connector.label.length * 14 * 0.55 + 12;

    body += `<rect x="${num(at.x - width / 2)}" y="${num(at.y - 11)}" width="${num(width)}" height="22" fill="#FFFFFF"/>`;
    body += lines([connector.label], at.x, at.y - 8, 14, connector.stroke, 'middle');
  }

  return body;
};

const frameSvg = (frame: FrameObject) =>
  `<rect x="${num(frame.x)}" y="${num(frame.y)}" width="${num(frame.w)}" height="${num(frame.h)}" fill="rgba(148, 163, 184, 0.08)" stroke="#94A3B8" stroke-width="1.5" stroke-dasharray="6 4"/>${lines(
    [frame.title || 'Frame'],
    frame.x,
    frame.y - 18,
    14,
    '#475569',
    'start',
  )}`;

const objectSvg = (object: BoardObject, objects: Map<string, BoardObject>, wrap: Wrap): string => {
  switch (object.type) {
    case 'stroke':
      return strokeSvg(object);
    case 'shape':
      return shapeSvg(object, wrap);
    case 'text':
      return textSvg(object, wrap);
    case 'sticky':
      return stickySvg(object, wrap);
    case 'image':
      return imageSvg(object);
    case 'connector':
      return connectorSvg(object, objects);
    case 'frame':
      return frameSvg(object);
    default:
      return '';
  }
};

/** Bounds of everything, with room for frame titles and line widths. */
export const contentBoundsOf = (objects: BoardObject[], padding: number): Rect | null => {
  if (!objects.length) return null;

  const map = new Map(objects.map((object) => [object.id, object]));
  const bounds = unionRect(objects.map((object) => objectBounds(object, map)));

  if (!bounds) return null;

  return { x: bounds.x - padding, y: bounds.y - padding, w: bounds.w + padding * 2, h: bounds.h + padding * 2 };
};

/**
 * The board as an SVG document: every object in z order, frames first by
 * their own z, sized to the content. Strokes are the same perfect-freehand
 * outlines the canvas fills, so the file matches the screen.
 */
export const toSvg = (objects: BoardObject[], options: SvgOptions = {}): string => {
  const wrap = options.wrap ?? defaultWrap();
  const bounds = contentBoundsOf(objects, options.padding ?? 24) ?? { x: 0, y: 0, w: 100, h: 100 };
  const map = new Map(objects.map((object) => [object.id, object]));
  const body = [...objects].sort(byZ).map((object) => objectSvg(object, map, wrap)).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(bounds.x)} ${num(bounds.y)} ${num(bounds.w)} ${num(bounds.h)}" width="${num(bounds.w)}" height="${num(bounds.h)}">\n${body}\n</svg>`;
};

/** Saves the board as an SVG file through the browser's download flow. */
export const downloadSvg = (objects: BoardObject[], filename: string) => {
  const blob = new Blob([toSvg(objects)], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  anchor.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
