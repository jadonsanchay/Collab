import { useEffect } from 'react';

import { BsArrowsMove } from 'react-icons/bs';

import { CANVAS_SIZE } from '@/common/constants/canvasSize';
import { socket } from '@/common/lib/socket';
import { useViewportStore } from '@/common/store/viewport.store';

import { useMovesHandlers } from '../../../hooks/useMovesHandlers';
import { useRefs } from '../../../hooks/useRefs';
import { useCtx } from '../hooks/useCtx';
import { useDraw } from '../hooks/useDraw';
import { useSocketDraw } from '../hooks/useSocketDraw';
import { useViewportGestures } from '../hooks/useViewportGestures';
import Background from './Background';
import MiniMap from './Minimap';
import ZoomControls from './ZoomControls';

const Canvas = () => {
  const { canvasRef, liveRef, bgRef, undoRef, redoRef } = useRefs();
  const ctx = useCtx();

  const x = useViewportStore((state) => state.x);
  const y = useViewportStore((state) => state.y);
  const scale = useViewportStore((state) => state.scale);

  const {
    handTool,
    setHandTool,
    isPanning,
    handlePointerDown: handlePanPointerDown,
    handlePointerMove: handlePanPointerMove,
    handlePointerUp: handlePanPointerUp,
    handleWheel,
  } = useViewportGestures();

  const { handleEndDrawing, handleDraw, handleStartDrawing, drawing } =
    useDraw(isPanning);
  useSocketDraw(drawing);

  const { handleUndo, handleRedo } = useMovesHandlers();

  // SETUP
  useEffect(() => {
    const undoBtn = undoRef.current;
    const redoBtn = redoRef.current;

    undoBtn?.addEventListener('click', handleUndo);
    redoBtn?.addEventListener('click', handleRedo);

    return () => {
      undoBtn?.removeEventListener('click', handleUndo);
      redoBtn?.removeEventListener('click', handleRedo);
    };
  }, [canvasRef, handleRedo, handleUndo, redoRef, undoRef]);

  useEffect(() => {
    if (ctx) socket.emit('joined_room');
  }, [ctx]);

  return (
    <div
      className="relative size-full overflow-hidden"
      onWheel={handleWheel}
    >
      <div
        className="absolute left-0 top-0"
        style={{
          transform: `translate(${x}px, ${y}px) scale(${scale})`,
          transformOrigin: '0 0',
        }}
      >
        <Background bgRef={bgRef} />

        <canvas
          // SETTINGS
          ref={canvasRef}
          width={CANVAS_SIZE.width}
          height={CANVAS_SIZE.height}
          className={`absolute top-0 z-10 ${isPanning && 'cursor-move'}`}
          style={{ touchAction: 'none' }}
          // HANDLERS
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onPointerDown={(e) => {
            if (handlePanPointerDown(e)) return;

            e.currentTarget.setPointerCapture(e.pointerId);
            handleStartDrawing(e.clientX, e.clientY);
          }}
          onPointerUp={(e) => {
            if (handlePanPointerUp(e)) return;

            handleEndDrawing();
          }}
          onPointerMove={(e) => {
            if (handlePanPointerMove(e)) return;

            handleDraw(e.clientX, e.clientY, e.shiftKey);
          }}
          onPointerCancel={handleEndDrawing}
        />

        <canvas
          ref={liveRef}
          width={CANVAS_SIZE.width}
          height={CANVAS_SIZE.height}
          className="pointer-events-none absolute top-0 z-20"
        />
      </div>

      <MiniMap dragging={isPanning} />

      <ZoomControls />

      <button
        type="button"
        className={`absolute bottom-14 right-5 z-10 rounded-xl md:bottom-5 ${
          handTool ? 'bg-green-500' : 'bg-zinc-300 text-black'
        } p-3 text-lg text-white`}
        onClick={() => setHandTool((prev) => !prev)}
      >
        <BsArrowsMove />
      </button>
    </div>
  );
};

export default Canvas;
