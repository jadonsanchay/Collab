import { Copy, Move, Trash2 } from 'lucide-react';

import { toScreen } from '@/common/lib/coords';
import { useOptionsValue } from '@/common/store/options.store';
import { useViewportStore } from '@/common/store/viewport.store';

import { useRefs } from '../../../hooks/useRefs';

const SelectionBtns = () => {
  const { selection } = useOptionsValue();
  const { selectionRefs } = useRefs();
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
      <button
        type="button"
        className="rounded-full bg-gray-200 p-2"
        ref={(ref) => {
          if (ref && selectionRefs.current) selectionRefs.current[0] = ref;
        }}
      >
        <Move />
      </button>
      <button
        type="button"
        className="rounded-full bg-gray-200 p-2"
        ref={(ref) => {
          if (ref && selectionRefs.current) selectionRefs.current[1] = ref;
        }}
      >
        <Copy />
      </button>
      <button
        type="button"
        className="rounded-full bg-gray-200 p-2"
        ref={(ref) => {
          if (ref && selectionRefs.current) selectionRefs.current[2] = ref;
        }}
      >
        <Trash2 />
      </button>
    </div>
  );
};

export default SelectionBtns;
