import { MAX_IMAGE_BASE64_LENGTH } from '@/common/schemas/move';

/** Long edge of an image sent to the model. Enough detail, few tokens. */
export const MAX_AI_IMAGE_EDGE = 1024;

/** Scales a size down to fit `maxEdge` on its long side; never scales up. */
export const fitWithin = (width: number, height: number, maxEdge: number) => {
  const scale = Math.min(1, maxEdge / Math.max(width, height, 1));

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
};

/**
 * Re-draws a canvas to fit `maxEdge` and returns base64 PNG without the
 * data-URL prefix. Halves the size until the payload fits the wire cap, and
 * returns an empty string if even a tiny image will not.
 */
export const canvasToPngBase64 = (
  source: HTMLCanvasElement,
  maxEdge = MAX_AI_IMAGE_EDGE,
  maxLength = MAX_IMAGE_BASE64_LENGTH,
): string => {
  let { width, height } = fitWithin(source.width, source.height, maxEdge);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.drawImage(source, 0, 0, width, height);

    const dataUrl = canvas.toDataURL('image/png');
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);

    if (base64.length <= maxLength) return base64;

    width = Math.max(1, Math.round(width / 2));
    height = Math.max(1, Math.round(height / 2));
  }

  return '';
};
