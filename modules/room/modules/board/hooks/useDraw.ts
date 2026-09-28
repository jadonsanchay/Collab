import { useState } from 'react';

import { v4 } from 'uuid';

import { DEFAULT_MOVE } from '@/common/constants/defaultMove';
import { toBoard } from '@/common/lib/coords';
import { getStringFromRgba } from '@/common/lib/rgba';
import { socket } from '@/common/lib/socket';
import { useOptionsValue, useSetSelection } from '@/common/store/options.store';
import { useMyMoves } from '@/common/store/room.store';
import { useSetSavedMoves } from '@/common/store/history.store';
import { useViewportStore } from '@/common/store/viewport.store';
import {
  DEFAULT_TEMP_CIRCLE,
  DEFAULT_TEMP_SIZE,
  useDrawingStore,
} from '@/common/store/drawing.store';
import { Move } from '@/common/types/global';

import { drawRect, drawCircle } from '../helpers/Canvas.helpers';
import { useLiveCtx } from './useCtx';
import { useLiveStrokeBroadcast } from './useLiveStrokeBroadcast';

export const useDraw = (blocked: boolean) => {
  const options = useOptionsValue();
  const { clearSavedMoves } = useSetSavedMoves();
  const { handleAddMyMove } = useMyMoves();
  const { setSelection, clearSelection } = useSetSelection();

  const [drawing, setDrawing] = useState(false);
  const liveCtx = useLiveCtx();
  const liveStroke = useLiveStrokeBroadcast();

  const setupCtxOptions = () => {
    if (liveCtx) {
      liveCtx.lineWidth = options.lineWidth;
      liveCtx.strokeStyle = getStringFromRgba(options.lineColor);
      liveCtx.fillStyle = getStringFromRgba(options.fillColor);
      if (options.mode === 'eraser')
        liveCtx.globalCompositeOperation = 'destination-out';
      else liveCtx.globalCompositeOperation = 'source-over';
    }
  };

  const clearLiveLayer = () => {
    liveCtx?.clearRect(0, 0, liveCtx.canvas.width, liveCtx.canvas.height);
  };

  const handleStartDrawing = (x: number, y: number) => {
    if (!liveCtx || blocked) return;

    const { x: vx, y: vy, scale } = useViewportStore.getState();
    const [finalX, finalY] = [toBoard(x, vx, scale), toBoard(y, vy, scale)];

    setDrawing(true);
    setupCtxOptions();

    if (options.shape === 'line' && options.mode !== 'select') {
      liveCtx.beginPath();
      liveCtx.lineTo(finalX, finalY);
      liveCtx.stroke();
    }

    let { strokeId } = useDrawingStore.getState();

    if (options.mode !== 'select') {
      // Generated once per stroke and reused as the eventual `draw` move's
      // `clientId`, so a receiver can match this preview to the committed
      // move that replaces it.
      strokeId = v4();
      liveStroke.start(strokeId, options, [finalX, finalY]);
    }

    useDrawingStore.setState((state) => ({
      tempMoves: [...state.tempMoves, [finalX, finalY]],
      strokeId,
    }));
  };

  const handleDraw = (x: number, y: number, shift?: boolean) => {
    if (!liveCtx || !drawing || blocked) return;

    const { x: vx, y: vy, scale } = useViewportStore.getState();
    const [finalX, finalY] = [toBoard(x, vx, scale), toBoard(y, vy, scale)];

    const { tempMoves } = useDrawingStore.getState();

    if (options.mode !== 'select') liveStroke.addPoint([finalX, finalY]);

    clearLiveLayer();
    setupCtxOptions();

    if (options.mode === 'select') {
      liveCtx.fillStyle = 'rgba(0, 0, 0, 0.2)';
      drawRect(liveCtx, tempMoves[0], finalX, finalY, false, true);
      useDrawingStore.setState((state) => ({
        tempMoves: [...state.tempMoves, [finalX, finalY]],
      }));

      return;
    }

    switch (options.shape) {
      case 'line': {
        const points = shift ? tempMoves.slice(0, 1) : tempMoves;
        const newPoints = [...points, [finalX, finalY] as [number, number]];

        // Redrawn from scratch each frame: the live layer is cleared above,
        // so the whole accumulated path has to be re-stroked, not just the
        // newest segment.
        liveCtx.beginPath();
        liveCtx.moveTo(newPoints[0][0], newPoints[0][1]);
        newPoints.slice(1).forEach(([px, py]) => liveCtx.lineTo(px, py));
        liveCtx.stroke();

        useDrawingStore.setState({ tempMoves: newPoints });
        break;
      }

      case 'circle':
        useDrawingStore.setState({
          tempCircle: drawCircle(liveCtx, tempMoves[0], finalX, finalY, shift),
        });
        break;

      case 'rect':
        useDrawingStore.setState({
          tempSize: drawRect(liveCtx, tempMoves[0], finalX, finalY, shift),
        });
        break;

      default:
        break;
    }
  };

  const handleEndDrawing = () => {
    if (!liveCtx || blocked) return;

    setDrawing(false);
    clearLiveLayer();

    const { tempMoves, tempCircle, tempSize, strokeId } =
      useDrawingStore.getState();

    if (options.mode !== 'select') liveStroke.end();

    let addMove = true;
    if (options.mode === 'select' && tempMoves.length) {
      let x = tempMoves[0][0];
      let y = tempMoves[0][1];
      let width = tempMoves[tempMoves.length - 1][0] - x;
      let height = tempMoves[tempMoves.length - 1][1] - y;

      if (width < 0) {
        width -= 4;
        x += 2;
      } else {
        width += 4;
        x -= 2;
      }
      if (height < 0) {
        height -= 4;
        y += 2;
      } else {
        height += 4;
        y -= 2;
      }

      if ((width < 4 || width > 4) && (height < 4 || height > 4))
        setSelection({ x, y, width, height });
      else {
        clearSelection();
        addMove = false;
      }
    }

    const move: Move = {
      ...DEFAULT_MOVE,
      // Reuses the live-stroke's id when there was one, so a receiver's
      // preview is recognised as replaced by this move rather than lingering
      // until its timeout. Falls back to a fresh id for a select-mode move,
      // which never broadcast a live stroke in the first place.
      clientId: strokeId ?? v4(),
      rect: {
        ...tempSize,
      },
      circle: {
        ...tempCircle,
      },
      path: tempMoves,
      options,
    };

    useDrawingStore.setState({
      tempMoves: [],
      tempCircle: DEFAULT_TEMP_CIRCLE,
      tempSize: DEFAULT_TEMP_SIZE,
      strokeId: null,
    });

    if (options.mode !== 'select') {
      socket.emit('draw', move);
      clearSavedMoves();
    } else if (addMove) handleAddMyMove(move);
  };

  return {
    handleEndDrawing,
    handleDraw,
    handleStartDrawing,
    drawing,
  };
};
