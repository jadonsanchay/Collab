import { useState } from 'react';

import { v4 } from 'uuid';

import { DEFAULT_MOVE } from '@/common/constants/defaultMove';
import { useViewportSize } from '@/common/hooks/useViewportSize';
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

import { drawRect, drawCircle, drawLine } from '../helpers/Canvas.helpers';
import { useCtx } from './useCtx';

// Module-level (not state/ref) so the in-progress stroke survives across renders without
// re-rendering on every pointer-move — but this means only one draw-in-progress can exist
// at a time across all instances of this hook.
let tempImageData: ImageData | undefined;

export const useDraw = (blocked: boolean) => {
  const options = useOptionsValue();
  const { clearSavedMoves } = useSetSavedMoves();
  const { handleAddMyMove } = useMyMoves();
  const { setSelection, clearSelection } = useSetSelection();
  const vw = useViewportSize();

  const [drawing, setDrawing] = useState(false);
  const ctx = useCtx();

  const setupCtxOptions = () => {
    if (ctx) {
      ctx.lineWidth = options.lineWidth;
      ctx.strokeStyle = getStringFromRgba(options.lineColor);
      ctx.fillStyle = getStringFromRgba(options.fillColor);
      if (options.mode === 'eraser')
        ctx.globalCompositeOperation = 'destination-out';
      else ctx.globalCompositeOperation = 'source-over';
    }
  };

  /**
   * `getImageData`/`putImageData` work in the canvas's own pixel space, which
   * never changes with zoom — only the region currently visible on screen
   * does, so the captured offset and size both need the current scale.
   */
  const drawAndSet = () => {
    const { x, y, scale } = useViewportStore.getState();
    const boardX = toBoard(0, x, scale);
    const boardY = toBoard(0, y, scale);
    const width = vw.width / scale;
    const height = vw.height / scale;

    if (!tempImageData)
      tempImageData = ctx?.getImageData(boardX, boardY, width, height);

    if (tempImageData) ctx?.putImageData(tempImageData, boardX, boardY);
  };

  const handleStartDrawing = (x: number, y: number) => {
    if (!ctx || blocked) return;

    const { x: vx, y: vy, scale } = useViewportStore.getState();
    const [finalX, finalY] = [toBoard(x, vx, scale), toBoard(y, vy, scale)];

    setDrawing(true);
    setupCtxOptions();
    drawAndSet();

    if (options.shape === 'line' && options.mode !== 'select') {
      ctx.beginPath();
      ctx.lineTo(finalX, finalY);
      ctx.stroke();
    }

    useDrawingStore.setState((state) => ({
      tempMoves: [...state.tempMoves, [finalX, finalY]],
    }));
  };

  const handleDraw = (x: number, y: number, shift?: boolean) => {
    if (!ctx || !drawing || blocked) return;

    const { x: vx, y: vy, scale } = useViewportStore.getState();
    const [finalX, finalY] = [toBoard(x, vx, scale), toBoard(y, vy, scale)];

    drawAndSet();

    const { tempMoves } = useDrawingStore.getState();

    if (options.mode === 'select') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
      drawRect(ctx, tempMoves[0], finalX, finalY, false, true);
      useDrawingStore.setState((state) => ({
        tempMoves: [...state.tempMoves, [finalX, finalY]],
      }));

      setupCtxOptions();

      return;
    }

    switch (options.shape) {
      case 'line': {
        const points = shift ? tempMoves.slice(0, 1) : tempMoves;

        drawLine(ctx, points[0], finalX, finalY, shift);

        useDrawingStore.setState({ tempMoves: [...points, [finalX, finalY]] });
        break;
      }

      case 'circle':
        useDrawingStore.setState({
          tempCircle: drawCircle(ctx, tempMoves[0], finalX, finalY, shift),
        });
        break;

      case 'rect':
        useDrawingStore.setState({
          tempSize: drawRect(ctx, tempMoves[0], finalX, finalY, shift),
        });
        break;

      default:
        break;
    }
  };

  const clearOnYourMove = () => {
    drawAndSet();
    tempImageData = undefined;
  };

  const handleEndDrawing = () => {
    if (!ctx || blocked) return;

    setDrawing(false);

    ctx.closePath();

    const { tempMoves, tempCircle, tempSize } = useDrawingStore.getState();

    let addMove = true;
    if (options.mode === 'select' && tempMoves.length) {
      clearOnYourMove();
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
      // Identifies this move across a resend, so a retry is recognised by the
      // server instead of drawn twice.
      clientId: v4(),
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
    clearOnYourMove,
  };
};
