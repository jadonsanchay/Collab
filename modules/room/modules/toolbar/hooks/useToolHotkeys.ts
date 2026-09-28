import { useEffect } from 'react';

import {
  isCircleTool,
  isEraserTool,
  isImageTool,
  isLineTool,
  isPenTool,
  isRectTool,
  isSelectTool,
  isTypingTarget,
  isWidthDecrease,
  isWidthIncrease,
} from '@/common/lib/keyboard';
import { useOptionsStore } from '@/common/store/options.store';

const MIN_WIDTH = 1;
const MAX_WIDTH = 20;

/**
 * V/H/P/E/R/O/L/I plus `[`/`]` for line width — the single-letter tool
 * shortcuts, wired directly against the options store (imperative
 * getState/setState, same pattern as the other global keydown listeners in
 * this codebase) rather than through component state, since this hook is
 * mounted once at the toolbar and has no UI of its own.
 */
export const useToolHotkeys = ({ onOpenImageInput }: { onOpenImageInput: () => void }) => {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;

      const { setOptions } = useOptionsStore.getState();

      if (isSelectTool(event)) {
        setOptions((prev) => ({ ...prev, mode: 'select' }));
      } else if (isPenTool(event) || isLineTool(event)) {
        setOptions((prev) => ({ ...prev, mode: 'draw', shape: 'line' }));
      } else if (isEraserTool(event)) {
        setOptions((prev) => ({ ...prev, mode: 'eraser' }));
      } else if (isRectTool(event)) {
        setOptions((prev) => ({ ...prev, mode: 'draw', shape: 'rect' }));
      } else if (isCircleTool(event)) {
        setOptions((prev) => ({ ...prev, mode: 'draw', shape: 'circle' }));
      } else if (isImageTool(event)) {
        onOpenImageInput();
      } else if (isWidthDecrease(event)) {
        setOptions((prev) => ({
          ...prev,
          lineWidth: Math.max(MIN_WIDTH, prev.lineWidth - 1),
        }));
      } else if (isWidthIncrease(event)) {
        setOptions((prev) => ({
          ...prev,
          lineWidth: Math.min(MAX_WIDTH, prev.lineWidth + 1),
        }));
      } else {
        return;
      }

      event.preventDefault();
    };

    document.addEventListener('keydown', listener);

    return () => document.removeEventListener('keydown', listener);
  }, [onOpenImageInput]);
};
