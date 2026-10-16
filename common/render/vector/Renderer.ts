import RBush from 'rbush';
import getStroke from 'perfect-freehand';

import { type Camera, visibleWorld } from '@/common/vector/camera';
import { aabb, boundsOfPoints, rectsIntersect, resolveAnchor, strokeWorldPoints } from '@/common/vector/geometry';
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

import { fontFor, LINE_HEIGHT, wrapLines } from './text';

type Indexed = { minX: number; minY: number; maxX: number; maxY: number; id: string };

export type LiveStroke = { points: [number, number, number][]; color: string; size: number };

export type SelectionOverlay = {
  ids: Set<string>;
  /** Marquee being dragged, in world space. */
  marquee?: Rect | null;
  /** Snap guides to draw, in world space. */
  guides?: { x?: number[]; y?: number[] };
  /** Remote selections: userId → object ids with a colour. */
  remote?: { ids: string[]; color: string }[];
};

export const HANDLE_SIZE = 8;

const STATIC_CACHE_IDLE_MS = 100;

const HANDLE_COLOR = '#2563EB';

/** Outline of a stroke from perfect-freehand, cached per object identity. */
const outlineFor = (stroke: StrokeObject, cache: Map<string, Path2D>): Path2D => {
  const key = `${stroke.id}:${stroke.size}:${stroke.points.length}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const hasPressure = stroke.points.some(([, , pressure]) => pressure > 0 && pressure !== 0.5);
  const outline = getStroke(stroke.points, {
    size: stroke.size,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.4,
    simulatePressure: !hasPressure,
    last: true,
  });

  const path = new Path2D();

  outline.forEach(([x, y], index) => {
    if (index === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  });
  path.closePath();

  cache.set(key, path);

  return path;
};

const shapePath = (shape: ShapeObject): Path2D => {
  const { w, h } = shape;
  const path = new Path2D();

  switch (shape.kind) {
    case 'ellipse':
      path.ellipse(w / 2, h / 2, Math.max(w / 2, 0.01), Math.max(h / 2, 0.01), 0, 0, Math.PI * 2);
      break;
    case 'triangle':
      path.moveTo(w / 2, 0);
      path.lineTo(w, h);
      path.lineTo(0, h);
      path.closePath();
      break;
    case 'diamond':
      path.moveTo(w / 2, 0);
      path.lineTo(w, h / 2);
      path.lineTo(w / 2, h);
      path.lineTo(0, h / 2);
      path.closePath();
      break;
    case 'line':
    case 'arrow':
      path.moveTo(0, 0);
      path.lineTo(w, h);
      break;
    default:
      path.rect(0, 0, w, h);
  }

  return path;
};

/** Positions the context at an object's top-left with its rotation applied. */
const applyRotation = (ctx: CanvasRenderingContext2D, object: Rect & { rotation: number }) => {
  ctx.translate(object.x + object.w / 2, object.y + object.h / 2);
  ctx.rotate((object.rotation * Math.PI) / 180);
  ctx.translate(-object.w / 2, -object.h / 2);
};

export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** The eight resize handles of a box, in world space. */
export const handlePositionsOf = (box: Rect): { x: number; y: number; handle: Handle }[] => {
  const midX = box.x + box.w / 2;
  const midY = box.y + box.h / 2;

  return [
    { x: box.x, y: box.y, handle: 'nw' },
    { x: midX, y: box.y, handle: 'n' },
    { x: box.x + box.w, y: box.y, handle: 'ne' },
    { x: box.x + box.w, y: midY, handle: 'e' },
    { x: box.x + box.w, y: box.y + box.h, handle: 'se' },
    { x: midX, y: box.y + box.h, handle: 's' },
    { x: box.x, y: box.y + box.h, handle: 'sw' },
    { x: box.x, y: midY, handle: 'w' },
  ];
};

const arrowHead = (ctx: CanvasRenderingContext2D, from: Point, to: Point, size: number) => {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const spread = Math.PI / 7;

  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(angle - spread), to.y - size * Math.sin(angle - spread));
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(angle + spread), to.y - size * Math.sin(angle + spread));
  ctx.stroke();
};

/** The connector's path points in world space, resolved against current objects. */
export const connectorPoints = (
  connector: ConnectorObject,
  objects: Map<string, BoardObject>,
): Point[] | null => {
  const from = resolveAnchor(connector.from, objects);
  const to = resolveAnchor(connector.to, objects);

  if (!from || !to) return null;

  if (connector.style === 'elbow') {
    const midX = (from.x + to.x) / 2;

    return [from, { x: midX, y: from.y }, { x: midX, y: to.y }, to];
  }

  return [from, to];
};

/** Bounds of a connector for indexing, from its resolved endpoints. */
export const connectorBounds = (connector: ConnectorObject, objects: Map<string, BoardObject>): Rect => {
  const points = connectorPoints(connector, objects);

  return points ? boundsOfPoints(points, connector.strokeWidth + 12) : aabb(connector);
};

/** Bounds used for culling and hit testing: strokes and connectors compute theirs. */
export const objectBounds = (object: BoardObject, objects: Map<string, BoardObject>): Rect => {
  if (object.type === 'connector') return connectorBounds(object, objects);
  if (object.type === 'stroke') return boundsOfPoints(strokeWorldPoints(object), object.size);

  return aabb(object);
};

const drawShape = (ctx: CanvasRenderingContext2D, shape: ShapeObject) => {
  applyRotation(ctx, shape);

  const path = shapePath(shape);

  ctx.lineWidth = shape.strokeWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = shape.stroke;

  if (shape.fill && shape.kind !== 'line' && shape.kind !== 'arrow') {
    ctx.fillStyle = shape.fill;
    ctx.fill(path);
  }

  ctx.stroke(path);

  if (shape.kind === 'arrow') {
    arrowHead(ctx, { x: 0, y: 0 }, { x: shape.w, y: shape.h }, Math.max(10, shape.strokeWidth * 4));
  }

  if (shape.text) {
    const fontSize = Math.max(10, Math.min(28, shape.h / 5));

    ctx.fillStyle = shape.stroke;
    ctx.font = fontFor(fontSize);
    ctx.textBaseline = 'top';

    const lines = wrapLines(ctx, shape.text, Math.max(10, shape.w - 16));
    const blockHeight = lines.length * fontSize * LINE_HEIGHT;
    let y = Math.max(4, (shape.h - blockHeight) / 2);

    ctx.textAlign = 'center';
    lines.forEach((line) => {
      ctx.fillText(line, shape.w / 2, y);
      y += fontSize * LINE_HEIGHT;
    });
  }
};

const drawText = (ctx: CanvasRenderingContext2D, text: TextObject) => {
  applyRotation(ctx, text);

  ctx.fillStyle = text.color;
  ctx.font = fontFor(text.fontSize, text.fontFamily);
  ctx.textBaseline = 'top';
  ctx.textAlign = text.align;

  let anchorX = 0;
  if (text.align === 'center') anchorX = text.w / 2;
  else if (text.align === 'right') anchorX = text.w;

  let y = 0;

  wrapLines(ctx, text.text, Math.max(10, text.w)).forEach((line) => {
    ctx.fillText(line, anchorX, y);
    y += text.fontSize * LINE_HEIGHT;
  });
};

const drawSticky = (ctx: CanvasRenderingContext2D, sticky: StickyObject) => {
  applyRotation(ctx, sticky);

  ctx.shadowColor = 'rgba(0,0,0,0.15)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = sticky.fill;
  ctx.fillRect(0, 0, sticky.w, sticky.h);
  ctx.shadowColor = 'transparent';

  const padding = 14;

  ctx.fillStyle = '#1F2937';
  ctx.font = fontFor(sticky.fontSize);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  let y = padding;

  wrapLines(ctx, sticky.text, Math.max(10, sticky.w - padding * 2)).forEach((line) => {
    if (y + sticky.fontSize > sticky.h - padding) return;
    ctx.fillText(line, padding, y);
    y += sticky.fontSize * LINE_HEIGHT;
  });
};

/**
 * Draws the vector board onto a canvas at device resolution with a camera
 * transform. Framework-free; the board component feeds it objects, the
 * camera, the live stroke and the selection, and calls `markDirty`.
 *
 * Per frame only objects whose bounds intersect the viewport are drawn
 * (rbush). After a short idle the unselected objects are rendered once to an
 * offscreen canvas and blitted until something changes, so panning a large
 * board costs one image draw instead of thousands of paths.
 */
export class VectorRenderer {
  private ctx: CanvasRenderingContext2D;

  private index = new RBush<Indexed>();

  private objects = new Map<string, BoardObject>();

  private ordered: BoardObject[] = [];

  private camera: Camera = { x: 0, y: 0, zoom: 1 };

  private selection: SelectionOverlay = { ids: new Set() };

  private liveStrokes: LiveStroke[] = [];

  private outlineCache = new Map<string, Path2D>();

  private images = new Map<string, HTMLImageElement>();

  private dirty = true;

  private frame: number | null = null;

  private staticCache: { canvas: HTMLCanvasElement; camera: Camera; width: number; height: number } | null = null;

  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  private destroyed = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private options: { dpr?: number; onFrame?: () => void } = {},
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
  }

  get dpr() {
    return this.options.dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  }

  /** Sizes the backing store to the CSS size times the device pixel ratio. */
  resize(width: number, height: number) {
    const { dpr } = this;

    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.invalidateStatic();
    this.markDirty();
  }

  setObjects(objects: BoardObject[]) {
    this.objects = new Map(objects.map((object) => [object.id, object]));
    this.ordered = [...objects].sort(byZ);

    const stale = new Set(this.outlineCache.keys());
    this.ordered.forEach((object) => {
      if (object.type === 'stroke') stale.delete(`${object.id}:${object.size}:${object.points.length}`);
    });
    stale.forEach((key) => this.outlineCache.delete(key));

    this.index.clear();
    this.index.load(
      this.ordered.map((object) => {
        const bounds = objectBounds(object, this.objects);

        return { minX: bounds.x, minY: bounds.y, maxX: bounds.x + bounds.w, maxY: bounds.y + bounds.h, id: object.id };
      }),
    );

    this.invalidateStatic();
    this.markDirty();
  }

  setCamera(camera: Camera) {
    if (camera.x === this.camera.x && camera.y === this.camera.y && camera.zoom === this.camera.zoom) return;

    this.camera = camera;
    this.invalidateStatic();
    this.markDirty();
  }

  setSelection(selection: SelectionOverlay) {
    const changed =
      selection.ids.size !== this.selection.ids.size ||
      [...selection.ids].some((id) => !this.selection.ids.has(id));

    this.selection = selection;

    if (changed) this.invalidateStatic();
    this.markDirty();
  }

  setLiveStrokes(strokes: LiveStroke[]) {
    this.liveStrokes = strokes;
    this.markDirty();
  }

  /** Objects whose bounds intersect a world rectangle, bottom to top. */
  query(rect: Rect): BoardObject[] {
    const hits = this.index.search({ minX: rect.x, minY: rect.y, maxX: rect.x + rect.w, maxY: rect.y + rect.h });
    const ids = new Set(hits.map((hit) => hit.id));

    return this.ordered.filter((object) => ids.has(object.id));
  }

  /** Bounding box of everything, or null for an empty board. */
  contentBounds(): Rect | null {
    if (!this.ordered.length) return null;

    const all = this.index.all();
    const minX = Math.min(...all.map((item) => item.minX));
    const minY = Math.min(...all.map((item) => item.minY));
    const maxX = Math.max(...all.map((item) => item.maxX));
    const maxY = Math.max(...all.map((item) => item.maxY));

    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  markDirty() {
    this.dirty = true;

    if (this.frame !== null || this.destroyed) return;

    this.frame = requestAnimationFrame(() => {
      this.frame = null;

      if (this.dirty) this.render();
    });
  }

  destroy() {
    this.destroyed = true;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    if (this.idleTimer) clearTimeout(this.idleTimer);
  }

  private invalidateStatic() {
    this.staticCache = null;

    if (this.idleTimer) clearTimeout(this.idleTimer);

    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.destroyed) this.buildStatic();
    }, STATIC_CACHE_IDLE_MS);
  }

  private viewport() {
    return { width: this.canvas.width / this.dpr, height: this.canvas.height / this.dpr };
  }

  private applyCamera(ctx: CanvasRenderingContext2D) {
    const { dpr } = this;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);
  }

  private buildStatic() {
    const cache = document.createElement('canvas');
    cache.width = this.canvas.width;
    cache.height = this.canvas.height;

    const ctx = cache.getContext('2d');
    if (!ctx) return;

    this.applyCamera(ctx);
    this.drawObjects(ctx, (object) => !this.selection.ids.has(object.id));

    this.staticCache = { canvas: cache, camera: this.camera, width: cache.width, height: cache.height };
    this.markDirty();
  }

  private render() {
    this.dirty = false;

    const { ctx } = this;
    const { width, height } = this.viewport();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const cache = this.staticCache;
    const cacheUsable =
      cache &&
      cache.camera === this.camera &&
      cache.width === this.canvas.width &&
      cache.height === this.canvas.height;

    if (cacheUsable) {
      ctx.drawImage(cache.canvas, 0, 0);
      this.applyCamera(ctx);
      this.drawObjects(ctx, (object) => this.selection.ids.has(object.id));
    } else {
      this.applyCamera(ctx);
      this.drawObjects(ctx, () => true);
    }

    this.drawLiveStrokes(ctx);
    this.drawSelection(ctx, width, height);
    this.options.onFrame?.();
  }

  private drawObjects(ctx: CanvasRenderingContext2D, include: (object: BoardObject) => boolean) {
    const view = visibleWorld(this.camera, this.viewport());
    const padded = { x: view.x - 50, y: view.y - 50, w: view.w + 100, h: view.h + 100 };

    this.query(padded).forEach((object) => {
      if (!include(object)) return;

      ctx.save();
      this.drawObject(ctx, object);
      ctx.restore();
    });
  }

  private drawObject(ctx: CanvasRenderingContext2D, object: BoardObject) {
    switch (object.type) {
      case 'stroke':
        this.drawStroke(ctx, object);
        break;
      case 'shape':
        drawShape(ctx, object);
        break;
      case 'text':
        drawText(ctx, object);
        break;
      case 'sticky':
        drawSticky(ctx, object);
        break;
      case 'image':
        this.drawImage(ctx, object);
        break;
      case 'connector':
        this.drawConnector(ctx, object);
        break;
      case 'frame':
        this.drawFrame(ctx, object);
        break;
      default:
        break;
    }
  }

  private drawStroke(ctx: CanvasRenderingContext2D, stroke: StrokeObject) {
    ctx.translate(stroke.x, stroke.y);
    ctx.fillStyle = stroke.color;
    ctx.fill(outlineFor(stroke, this.outlineCache));
  }



  private drawImage(ctx: CanvasRenderingContext2D, image: ImageObject) {
    applyRotation(ctx, image);

    const cached = this.images.get(image.url);

    if (cached && cached.complete && cached.naturalWidth) {
      ctx.drawImage(cached, 0, 0, image.w, image.h);
      return;
    }

    if (!cached && typeof Image !== 'undefined') {
      const element = new Image();
      if (/^https?:\/\//u.test(image.url)) element.crossOrigin = 'anonymous';
      element.addEventListener('load', () => {
        this.invalidateStatic();
        this.markDirty();
      });
      element.src = image.url;
      this.images.set(image.url, element);
    }

    // Placeholder while loading.
    ctx.fillStyle = '#E5E7EB';
    ctx.fillRect(0, 0, image.w, image.h);
  }

  private drawConnector(ctx: CanvasRenderingContext2D, connector: ConnectorObject) {
    const points = connectorPoints(connector, this.objects);
    if (!points) return;

    ctx.strokeStyle = connector.stroke;
    ctx.lineWidth = connector.strokeWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();

    if (connector.style === 'curved' && points.length === 2) {
      const [from, to] = points;
      const dx = (to.x - from.x) / 2;

      ctx.moveTo(from.x, from.y);
      ctx.bezierCurveTo(from.x + dx, from.y, to.x - dx, to.y, to.x, to.y);
    } else {
      points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
    }

    ctx.stroke();

    if (connector.arrowEnd) {
      const to = points[points.length - 1];
      const before = points[points.length - 2];

      arrowHead(ctx, before, to, Math.max(10, connector.strokeWidth * 4));
    }

    if (connector.label) {
      const mid = points[Math.floor((points.length - 1) / 2)];
      const next = points[Math.ceil((points.length - 1) / 2)];
      const labelPoint = { x: (mid.x + next.x) / 2, y: (mid.y + next.y) / 2 };

      ctx.font = fontFor(14);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const width = ctx.measureText(connector.label).width + 12;

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(labelPoint.x - width / 2, labelPoint.y - 11, width, 22);
      ctx.fillStyle = connector.stroke;
      ctx.fillText(connector.label, labelPoint.x, labelPoint.y);
    }
  }

  private drawFrame(ctx: CanvasRenderingContext2D, frame: FrameObject) {
    ctx.fillStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.fillRect(frame.x, frame.y, frame.w, frame.h);
    ctx.strokeStyle = '#94A3B8';
    ctx.lineWidth = 1.5 / this.camera.zoom;
    ctx.setLineDash([6 / this.camera.zoom, 4 / this.camera.zoom]);
    ctx.strokeRect(frame.x, frame.y, frame.w, frame.h);
    ctx.setLineDash([]);

    ctx.fillStyle = '#475569';
    ctx.font = fontFor(14 / this.camera.zoom);
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillText(frame.title || 'Frame', frame.x, frame.y - 4 / this.camera.zoom);
  }

  private drawLiveStrokes(ctx: CanvasRenderingContext2D) {
    this.liveStrokes.forEach((live) => {
      if (live.points.length < 1) return;

      const outline = getStroke(live.points, {
        size: live.size,
        thinning: 0.5,
        smoothing: 0.5,
        streamline: 0.4,
        simulatePressure: true,
        last: false,
      });

      ctx.fillStyle = live.color;
      ctx.beginPath();
      outline.forEach(([x, y], index) => {
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fill();
    });
  }

  private drawSelection(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const { zoom } = this.camera;
    const selected = this.ordered.filter((object) => this.selection.ids.has(object.id));

    ctx.lineWidth = 1.5 / zoom;

    (this.selection.remote ?? []).forEach(({ ids, color }) => {
      ctx.strokeStyle = color;
      ids.forEach((id) => {
        const object = this.objects.get(id);
        if (!object) return;

        const bounds = objectBounds(object, this.objects);
        ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
      });
    });

    if (selected.length) {
      ctx.strokeStyle = HANDLE_COLOR;

      selected.forEach((object) => {
        if (object.type === 'connector' || object.type === 'stroke') {
          const bounds = objectBounds(object, this.objects);
          ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
          return;
        }

        ctx.save();
        applyRotation(ctx, object);
        ctx.strokeRect(0, 0, object.w, object.h);
        ctx.restore();
      });

      const box = this.selectionBox();

      if (box) {
        const handle = HANDLE_SIZE / zoom;

        ctx.fillStyle = '#FFFFFF';
        ctx.strokeRect(box.x, box.y, box.w, box.h);

        handlePositionsOf(box).forEach(({ x, y }) => {
          ctx.fillRect(x - handle / 2, y - handle / 2, handle, handle);
          ctx.strokeRect(x - handle / 2, y - handle / 2, handle, handle);
        });

        // Rotation handle above the top edge.
        const rotate = { x: box.x + box.w / 2, y: box.y - 24 / zoom };
        ctx.beginPath();
        ctx.arc(rotate.x, rotate.y, handle / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    if (this.selection.marquee) {
      const { marquee } = this.selection;

      ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
      ctx.fillRect(marquee.x, marquee.y, marquee.w, marquee.h);
      ctx.strokeStyle = HANDLE_COLOR;
      ctx.setLineDash([4 / zoom, 4 / zoom]);
      ctx.strokeRect(marquee.x, marquee.y, marquee.w, marquee.h);
      ctx.setLineDash([]);
    }

    const { guides } = this.selection;

    if (guides) {
      const view = visibleWorld(this.camera, { width, height });

      ctx.strokeStyle = '#F43F5E';
      ctx.lineWidth = 1 / zoom;
      (guides.x ?? []).forEach((x) => {
        ctx.beginPath();
        ctx.moveTo(x, view.y);
        ctx.lineTo(x, view.y + view.h);
        ctx.stroke();
      });
      (guides.y ?? []).forEach((y) => {
        ctx.beginPath();
        ctx.moveTo(view.x, y);
        ctx.lineTo(view.x + view.w, y);
        ctx.stroke();
      });
    }
  }

  /** Axis-aligned box around the selection, in world space. */
  selectionBox(): Rect | null {
    const selected = this.ordered.filter((object) => this.selection.ids.has(object.id));

    if (!selected.length) return null;

    const boxes = selected.map((object) => objectBounds(object, this.objects));
    const minX = Math.min(...boxes.map((b) => b.x));
    const minY = Math.min(...boxes.map((b) => b.y));
    const maxX = Math.max(...boxes.map((b) => b.x + b.w));
    const maxY = Math.max(...boxes.map((b) => b.y + b.h));

    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  /** Which handle, if any, a world point is on. Rotation handle included. */
  handleAt(point: Point): Handle | 'rotate' | null {
    const box = this.selectionBox();
    if (!box) return null;

    const radius = HANDLE_SIZE / this.camera.zoom;
    // A thin selection (a straight pen stroke, a line) has edge handles that
    // would cover the whole object, so only its corners resize; the middle
    // of it must still be draggable.
    const thin = box.h * this.camera.zoom < HANDLE_SIZE * 3;
    const narrow = box.w * this.camera.zoom < HANDLE_SIZE * 3;
    // Nearest handle wins where two are within reach, so a corner beats the
    // edge handle beside it.
    const hit = handlePositionsOf(box)
      .filter(
        ({ x, y, handle }) =>
          !((thin && (handle === 'n' || handle === 's')) || (narrow && (handle === 'e' || handle === 'w'))) &&
          Math.abs(point.x - x) <= radius &&
          Math.abs(point.y - y) <= radius,
      )
      .sort((a, b) => Math.hypot(point.x - a.x, point.y - a.y) - Math.hypot(point.x - b.x, point.y - b.y))[0];

    if (hit) return hit.handle;

    const rotate = { x: box.x + box.w / 2, y: box.y - 24 / this.camera.zoom };

    if (Math.hypot(point.x - rotate.x, point.y - rotate.y) <= radius) return 'rotate';

    return null;
  }

  /** Whether the point is inside the selection box (for dragging the whole selection). */
  insideSelection(point: Point): boolean {
    const box = this.selectionBox();

    return Boolean(box && rectsIntersect(box, { x: point.x, y: point.y, w: 0.001, h: 0.001 }));
  }
}
