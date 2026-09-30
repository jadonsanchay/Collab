import { Maximize, Minus, Plus } from 'lucide-react';

import { useViewportSize } from '@/common/hooks/useViewportSize';
import { DEFAULT_CAMERA, fitTo, zoomAt } from '@/common/vector/camera';
import type { Rect } from '@/common/vector/types';
import { useVectorStore } from '@/common/store/vector.store';

const VectorZoomControls = ({ contentBounds }: { contentBounds: () => Rect | null }) => {
  const camera = useVectorStore((state) => state.camera);
  const setCamera = useVectorStore((state) => state.setCamera);
  const viewport = useViewportSize();
  const center = { x: viewport.width / 2, y: viewport.height / 2 };

  return (
    <div className="fixed bottom-5 right-24 z-40 flex items-center gap-1 rounded-xl bg-zinc-900 p-1 text-white">
      <button type="button" aria-label="Zoom out" className="rounded-lg p-2 hover:bg-zinc-700" onClick={() => setCamera(zoomAt(camera, center, 1 / 1.2))}>
        <Minus />
      </button>
      <button
        type="button"
        aria-label="Reset zoom to 100%"
        className="min-w-14 rounded-lg p-2 text-sm hover:bg-zinc-700"
        onClick={() => setCamera({ ...camera, zoom: DEFAULT_CAMERA.zoom })}
      >
        {Math.round(camera.zoom * 100)}%
      </button>
      <button type="button" aria-label="Zoom in" className="rounded-lg p-2 hover:bg-zinc-700" onClick={() => setCamera(zoomAt(camera, center, 1.2))}>
        <Plus />
      </button>
      <button
        type="button"
        aria-label="Fit content"
        className="rounded-lg p-2 hover:bg-zinc-700"
        onClick={() => {
          const bounds = contentBounds();
          setCamera(bounds ? fitTo(bounds, viewport) : DEFAULT_CAMERA);
        }}
      >
        <Maximize />
      </button>
    </div>
  );
};

export default VectorZoomControls;
