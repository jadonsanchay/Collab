import { getStringFromRgba } from '@/common/lib/rgba';
import { Move } from '@/common/types/global';

/**
 * Pure so it can run against any 2D context — the committed canvas, a live
 * preview layer, or (Phase 3) the server. Caches decoded images across calls
 * so a replay never re-decodes the same base64 payload twice.
 */
export const drawMove = (
  ctx: CanvasRenderingContext2D,
  move: Move,
  imageCache: Map<string, HTMLImageElement>,
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
      ctx.drawImage(cached, path[0][0], path[0][1]);
    } else {
      const img = new Image();
      img.src = move.img.base64;
      img.addEventListener('load', () => {
        imageCache.set(move.id, img);
        ctx.drawImage(img, path[0][0], path[0][1]);
      });
    }

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

    default:
      break;
  }
};

/**
 * Preloads every image move's `<img>` so a replay (checkpoint or full) can
 * draw them synchronously instead of racing a `load` event per move.
 */
export const preloadImages = async (
  moves: Move[],
  imageCache: Map<string, HTMLImageElement>,
) => {
  const imageMoves = moves.filter(
    (move) => move.options.shape === 'image' && !imageCache.has(move.id),
  );

  await Promise.all(
    imageMoves.map(
      (move) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.src = move.img.base64;
          img.addEventListener('load', () => {
            imageCache.set(move.id, img);
            resolve();
          });
        }),
    ),
  );
};
