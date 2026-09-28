import { AiOutlineMinus, AiOutlinePlus } from 'react-icons/ai';

import { useViewportSize } from '@/common/hooks/useViewportSize';
import { useViewportStore } from '@/common/store/viewport.store';

const ZOOM_STEP = 0.1;

const ZoomControls = () => {
  const scale = useViewportStore((state) => state.scale);
  const zoomTo = useViewportStore((state) => state.zoomTo);
  const fitToBoard = useViewportStore((state) => state.fitToBoard);
  const viewportSize = useViewportSize();

  return (
    <div className="absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-xl bg-zinc-900 p-1 text-white md:bottom-5 md:left-auto md:right-24 md:translate-x-0">
      <button
        type="button"
        className="rounded-lg p-2 hover:bg-zinc-700"
        onClick={() => zoomTo(scale * (1 - ZOOM_STEP), viewportSize)}
      >
        <AiOutlineMinus />
      </button>
      <button
        type="button"
        className="min-w-14 rounded-lg p-2 text-sm hover:bg-zinc-700"
        onClick={() => zoomTo(1, viewportSize)}
      >
        {Math.round(scale * 100)}%
      </button>
      <button
        type="button"
        className="rounded-lg p-2 hover:bg-zinc-700"
        onClick={() => zoomTo(scale * (1 + ZOOM_STEP), viewportSize)}
      >
        <AiOutlinePlus />
      </button>
      <button
        type="button"
        className="rounded-lg px-2 py-1 text-xs hover:bg-zinc-700"
        onClick={() => fitToBoard(viewportSize)}
      >
        Fit
      </button>
    </div>
  );
};

export default ZoomControls;
