import { getStringFromRgba } from '@/common/lib/rgba';
import { Move } from '@/common/types/global';

import { TEXT_LINE_HEIGHT, textFont } from './text';

/** Anything `drawImage` accepts: a browser `<img>`, or a Node canvas image. */
export type LoadedImage = CanvasImageSource;

export type ImageCache = Map<string, LoadedImage>;

/**
 * How an image move's pixels are fetched. The browser loader below creates
 * an `<img>`; the server passes one built on `@napi-rs/canvas` that reads
 * files and URLs. Injecting it is what lets the same `drawMove` render a
 * board in Node for snapshots and thumbnails.
 */
export type ImageLoader = (source: string) => Promise<LoadedImage>;

/** The URL or data URL an image move draws from, if it has one. */
export const imageSource = (move: Move): string | null =>
  move.img.url || move.img.base64 || null;

export const browserImageLoader: ImageLoader = (source) =>
  new Promise((resolve, reject) => {
    const img = new Image();

    // Object storage is another origin; without this the canvas would be
    // tainted and Download would stop working.
    if (/^https?:\/\//u.test(source)) img.crossOrigin = 'anonymous';

    img.addEventListener('load', () => resolve(img));
    img.addEventListener('error', () => reject(new Error(`failed to load ${source.slice(0, 80)}`)));
    img.src = source;
  });

const drawImageMove = (ctx: CanvasRenderingContext2D, move: Move, image: LoadedImage) => {
  const [x, y] = move.path[0];
  const { width, height } = move.img;

  if (width && height) ctx.drawImage(image, x, y, width, height);
  else ctx.drawImage(image, x, y);
};

/**
 * Pure so it can run against any 2D context — the committed canvas, a live
 * preview layer, or a Node canvas on the server. Caches decoded images across
 * calls so a replay never re-decodes the same payload twice.
 */
export const drawMove = (
  ctx: CanvasRenderingContext2D,
  move: Move,
  imageCache: ImageCache,
  loader: ImageLoader = browserImageLoader,
) => {
  const { path, options } = move;

  if (!path.length || options.mode === 'select') return;

  ctx.lineWidth = options.lineWidth;
  ctx.strokeStyle = getStringFromRgba(options.lineColor);
  ctx.fillStyle = getStringFromRgba(options.fillColor);
  ctx.globalCompositeOperation =
    options.mode === 'eraser' ? 'destination-out' : 'source-over';

  if (options.shape === 'image') {
    const cached = imageCache.get(move.id);

    if (cached) {
      drawImageMove(ctx, move, cached);
      return;
    }

    const source = imageSource(move);
    if (!source) return;

    // Not preloaded: draw when it arrives. Replays preload first, so this is
    // the path for a single freshly placed image.
    loader(source)
      .then((image) => {
        imageCache.set(move.id, image);
        drawImageMove(ctx, move, image);
      })
      .catch(() => {});

    return;
  }

  switch (options.shape) {
    case 'line': {
      ctx.beginPath();
      path.forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.stroke();
      ctx.closePath();
      break;
    }

    case 'circle': {
      const { cX, cY, radiusX, radiusY } = move.circle;

      ctx.beginPath();
      ctx.ellipse(cX, cY, radiusX, radiusY, 0, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.fill();
      ctx.closePath();
      break;
    }

    case 'rect': {
      const { width, height } = move.rect;

      ctx.beginPath();
      ctx.rect(path[0][0], path[0][1], width, height);
      ctx.stroke();
      ctx.fill();
      ctx.closePath();
      break;
    }

    case 'text': {
      if (!move.text) break;

      const { content, fontSize } = move.text;
      const [x, y] = path[0];

      // Text is filled in the line colour: the fill colour is the shape
      // interior, which text does not have.
      ctx.font = textFont(fontSize);
      ctx.textBaseline = 'top';
      ctx.fillStyle = getStringFromRgba(options.lineColor);

      content.split('\n').forEach((line, index) => {
        ctx.fillText(line, x, y + index * fontSize * TEXT_LINE_HEIGHT);
      });
      break;
    }

    default:
      break;
  }
};

/**
 * Decodes every image move ahead of a replay (checkpoint or full) so the
 * replay draws them synchronously instead of racing a load event per move.
 * A source that fails to load is skipped: one broken image must not stop
 * the rest of the board from rendering.
 */
export const preloadImages = async (
  moves: Move[],
  imageCache: ImageCache,
  loader: ImageLoader = browserImageLoader,
) => {
  const imageMoves = moves.filter(
    (move) => move.options.shape === 'image' && !imageCache.has(move.id) && imageSource(move),
  );

  await Promise.all(
    imageMoves.map(async (move) => {
      try {
        imageCache.set(move.id, await loader(imageSource(move) as string));
      } catch {
        // Skipped on purpose; see above.
      }
    }),
  );
};
