/** Line height as a multiple of the font size, shared by renderer and tool. */
export const TEXT_LINE_HEIGHT = 1.25;

export const MIN_TEXT_FONT_SIZE = 12;
export const MAX_TEXT_FONT_SIZE = 64;

/** The toolbar's line-width slider range, which doubles as the text-size control. */
const MIN_LINE_WIDTH = 1;
const MAX_LINE_WIDTH = 20;

/**
 * Maps the toolbar's 1 to 20 line width onto a 12 to 64 pixel font size, so
 * the slider that already sets stroke weight also sets text size and there
 * is nothing new to learn to make text bigger.
 */
export const lineWidthToFontSize = (lineWidth: number): number => {
  const clamped = Math.min(MAX_LINE_WIDTH, Math.max(MIN_LINE_WIDTH, lineWidth));
  const ratio = (clamped - MIN_LINE_WIDTH) / (MAX_LINE_WIDTH - MIN_LINE_WIDTH);

  return Math.round(
    MIN_TEXT_FONT_SIZE + ratio * (MAX_TEXT_FONT_SIZE - MIN_TEXT_FONT_SIZE),
  );
};

/**
 * Montserrat is loaded on every client by `_document.tsx`, so text renders
 * identically everywhere; the fallback only matters for server-side renders
 * without the font installed.
 */
export const TEXT_FONT_FAMILY = 'Montserrat, sans-serif';

export const textFont = (fontSize: number) => `${fontSize}px ${TEXT_FONT_FAMILY}`;
