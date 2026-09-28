import { useEffect, useRef, useState } from 'react';

import { isTypingTarget, isFitBoard, isZoomIn, isZoomOut, isZoomReset } from '@/common/lib/keyboard';
import { useViewportSize } from '@/common/hooks/useViewportSize';
import { useViewportStore } from '@/common/store/viewport.store';

const ZOOM_STEP = 0.1;

/**
 * Pan triggers: wheel, space held + left-drag, middle-button drag, right-button
 * drag (kept from the old right-click-to-pan behaviour), or the hand-tool
 * toggle. Zoom triggers: Cmd/Ctrl + wheel (also how Chrome reports trackpad
 * pinch), and the keyboard shortcuts below.
 */
export const useViewportGestures = () => {
  const [handTool, setHandTool] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const panBy = useViewportStore((state) => state.panBy);
  const zoomAt = useViewportStore((state) => state.zoomAt);
  const zoomTo = useViewportStore((state) => state.zoomTo);
  const fitToBoard = useViewportStore((state) => state.fitToBoard);
  const viewportSize = useViewportSize();

  const panPointer = useRef<{ id: number; lastX: number; lastY: number } | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        setSpaceHeld(true);
        return;
      }

      if (isZoomIn(e)) {
        e.preventDefault();
        zoomTo(useViewportStore.getState().scale * (1 + ZOOM_STEP), viewportSize);
      } else if (isZoomOut(e)) {
        e.preventDefault();
        zoomTo(useViewportStore.getState().scale * (1 - ZOOM_STEP), viewportSize);
      } else if (isZoomReset(e)) {
        e.preventDefault();
        zoomTo(1, viewportSize);
      } else if (isFitBoard(e)) {
        e.preventDefault();
        fitToBoard(viewportSize);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false);
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
    };
  }, [fitToBoard, viewportSize, zoomTo]);

  const isPanButton = (e: { pointerType: string; button: number }) =>
    e.button === 1 ||
    e.button === 2 ||
    (e.button === 0 && (handTool || spaceHeld));

  /** Returns true when the pointer event was consumed for panning. */
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!isPanButton(e)) return false;

    panPointer.current = { id: e.pointerId, lastX: e.clientX, lastY: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);

    return true;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!panPointer.current || panPointer.current.id !== e.pointerId) return false;

    const dx = e.clientX - panPointer.current.lastX;
    const dy = e.clientY - panPointer.current.lastY;

    panPointer.current.lastX = e.clientX;
    panPointer.current.lastY = e.clientY;

    panBy(dx, dy, viewportSize);

    return true;
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!panPointer.current || panPointer.current.id !== e.pointerId) return false;

    panPointer.current = null;

    return true;
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();

    if (e.ctrlKey || e.metaKey) {
      zoomAt(e.clientX, e.clientY, (-e.deltaY / 100) * ZOOM_STEP * 2, viewportSize);
    } else {
      panBy(-e.deltaX, -e.deltaY, viewportSize);
    }
  };

  return {
    handTool,
    setHandTool,
    isPanning: !!panPointer.current || handTool || spaceHeld,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleWheel,
  };
};
