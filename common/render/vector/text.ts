import { DEFAULT_FONT_FAMILY } from '@/common/vector/types';

export const LINE_HEIGHT = 1.3;

export const fontFor = (fontSize: number, family = DEFAULT_FONT_FAMILY) => `${fontSize}px ${family}`;

/**
 * Greedy word wrap against a measuring context. Words longer than a line
 * are broken. Explicit newlines start new lines.
 */
export const wrapLines = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] => {
  const lines: string[] = [];

  text.split('\n').forEach((paragraph) => {
    const words = paragraph.split(/(\s+)/u).filter((part) => part.length);
    let current = '';

    const push = () => {
      lines.push(current);
      current = '';
    };

    words.forEach((word) => {
      if (ctx.measureText(current + word).width <= maxWidth || current === '') {
        if (current === '' && ctx.measureText(word).width > maxWidth && word.trim()) {
          // Break a single too-long word character by character.
          let piece = '';

          word.split('').forEach((character) => {
            if (ctx.measureText(piece + character).width > maxWidth && piece) {
              lines.push(piece);
              piece = '';
            }

            piece += character;
          });

          current = piece;
        } else {
          current += word;
        }
      } else {
        push();
        current = word.trimStart();
      }
    });

    push();
  });

  return lines.map((line) => line.replace(/\s+$/u, ''));
};

/** Height a wrapped text needs at a font size. */
export const textHeight = (lines: number, fontSize: number) => Math.max(1, lines) * fontSize * LINE_HEIGHT;
