import { useEffect, useRef } from 'react';

import { toScreen } from '@/common/lib/coords';
import { isEscape } from '@/common/lib/keyboard';
import { getStringFromRgba } from '@/common/lib/rgba';
import {
  lineWidthToFontSize,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
} from '@/common/render/text';
import { MAX_TEXT_LENGTH } from '@/common/schemas/move';
import { useDrawingStore } from '@/common/store/drawing.store';
import { useOptionsValue } from '@/common/store/options.store';
import { useViewportStore } from '@/common/store/viewport.store';

import {
  closeTextInput,
  commitTextInput,
  updateTextInput,
} from '../lib/textTool';

/**
 * The floating editor for the text tool. `useDraw` opens it on pointer-down;
 * this turns what gets typed into a `text` move. Enter confirms, Shift+Enter
 * breaks the line, Escape cancels, and clicking away commits whatever is
 * there so a stray click never loses someone's text.
 *
 * Rendered in screen space at the anchor's projected position and scaled
 * with the viewport, so what is typed sits exactly where the move will land.
 */
const TextInput = () => {
  const textInput = useDrawingStore((state) => state.textInput);
  const options = useOptionsValue();
  const x = useViewportStore((state) => state.x);
  const y = useViewportStore((state) => state.y);
  const scale = useViewportStore((state) => state.scale);

  const ref = useRef<HTMLTextAreaElement>(null);
  const anchorKey = textInput ? `${textInput.x}:${textInput.y}` : null;

  useEffect(() => {
    if (!anchorKey) return;

    // Focus once the element exists. Focusing synchronously inside the
    // pointer-down that placed it would be undone by that same click.
    const frame = requestAnimationFrame(() => ref.current?.focus());

    // eslint-disable-next-line consistent-return -- cleanup only when a frame was requested
    return () => cancelAnimationFrame(frame);
  }, [anchorKey]);

  if (!textInput) return null;

  const fontSize = lineWidthToFontSize(options.lineWidth);
  const lines = textInput.value.split('\n');
  const cols = Math.max(6, ...lines.map((line) => line.length)) + 1;

  return (
    <textarea
      ref={ref}
      aria-label="Text"
      className="absolute z-30 resize-none overflow-hidden whitespace-pre border border-dashed border-zinc-400 bg-transparent p-0 outline-none"
      style={{
        left: toScreen(textInput.x, x, scale),
        top: toScreen(textInput.y, y, scale),
        fontFamily: TEXT_FONT_FAMILY,
        fontSize: fontSize * scale,
        lineHeight: TEXT_LINE_HEIGHT,
        color: getStringFromRgba(options.lineColor),
      }}
      rows={lines.length}
      cols={cols}
      value={textInput.value}
      maxLength={MAX_TEXT_LENGTH}
      onChange={(e) => updateTextInput(e.target.value)}
      onBlur={() => {
        // An empty box is left alone: the blur may be the click that is
        // about to place the next box, and closing here would fight it.
        if (textInput.value.trim()) commitTextInput();
      }}
      onKeyDown={(e) => {
        if (isEscape(e.nativeEvent)) {
          e.preventDefault();
          closeTextInput();
          return;
        }

        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          commitTextInput();
        }
      }}
    />
  );
};

export default TextInput;
