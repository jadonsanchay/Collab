import { Copy, Move, Sparkles, Trash2 } from 'lucide-react';

import HotkeyTooltip from '@/common/components/HotkeyTooltip';
import { useFeatureFlag } from '@/common/hooks/useFeatureFlag';
import { toScreen } from '@/common/lib/coords';
import { useOptionsValue } from '@/common/store/options.store';
import { useViewportStore } from '@/common/store/viewport.store';

import { useRefs } from '../../../hooks/useRefs';

/** The floating property bar that appears above a pixel selection. */
const SelectionBar = () => {
  const { selection } = useOptionsValue();
  const { selectionRefs } = useRefs();
  const ai = useFeatureFlag('ai');
  const boardX = useViewportStore((state) => state.x);
  const boardY = useViewportStore((state) => state.y);
  const scale = useViewportStore((state) => state.scale);

  let top = -40;
  let left = -40;

  if (selection) {
    const { x, y, width, height } = selection;
    top = toScreen(Math.min(y, y + height), boardY, scale) - 40;
    left = toScreen(Math.min(x, x + width), boardX, scale);
  }

  return (
    <div
      className="absolute left-0 top-0 z-50 flex items-center justify-center gap-2"
      style={{ top, left }}
    >
      <HotkeyTooltip label="Move">
        <button
          type="button"
          aria-label="Move selection"
          className="rounded-full bg-gray-200 p-2"
          ref={(ref) => {
            if (ref && selectionRefs.current) selectionRefs.current[0] = ref;
          }}
        >
          <Move />
        </button>
      </HotkeyTooltip>
      <HotkeyTooltip label="Copy" hotkey="⌘C">
        <button
          type="button"
          aria-label="Copy selection"
          className="rounded-full bg-gray-200 p-2"
          ref={(ref) => {
            if (ref && selectionRefs.current) selectionRefs.current[1] = ref;
          }}
        >
          <Copy />
        </button>
      </HotkeyTooltip>
      <HotkeyTooltip label="Delete" hotkey="Del">
        <button
          type="button"
          aria-label="Delete selection"
          className="rounded-full bg-gray-200 p-2"
          ref={(ref) => {
            if (ref && selectionRefs.current) selectionRefs.current[2] = ref;
          }}
        >
          <Trash2 />
        </button>
      </HotkeyTooltip>
      {ai && (
        <HotkeyTooltip label="Clean up with Sketch">
          <button
            type="button"
            aria-label="Clean up with Sketch"
            className="rounded-full bg-amber-200 p-2"
            ref={(ref) => {
              if (ref && selectionRefs.current) selectionRefs.current[3] = ref;
            }}
          >
            <Sparkles />
          </button>
        </HotkeyTooltip>
      )}
    </div>
  );
};

export default SelectionBar;
