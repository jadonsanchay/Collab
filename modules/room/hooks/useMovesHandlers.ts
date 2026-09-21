import { useCallback, useEffect, useMemo } from 'react';

import { v4 } from 'uuid';

import { isRedo, isTypingTarget, isUndo } from '@/common/lib/keyboard';
import { getStringFromRgba } from '@/common/lib/rgba';
import { socket } from '@/common/lib/socket';
import { useBackground } from '@/common/recoil/background';
import { useSetSelection } from '@/common/recoil/options';
import { useMyMoves, useRoom } from '@/common/recoil/room';
import { useSetSavedMoves } from '@/common/recoil/savedMoves';
import { Move } from '@/common/types/global';

import { useCtx } from '../modules/board/hooks/useCtx';
import { useRefs } from './useRefs';
import { useSelection } from '../modules/board/hooks/useSelection';

let prevMovesLength = 0;

export const useMovesHandlers = (clearOnYourMove: () => void) => {
  const { canvasRef, minimapRef, bgRef } = useRefs();
  const room = useRoom();
  const { handleAddMyMove, handleRemoveMyMove } = useMyMoves();
  const { addSavedMove, removeSavedMove } = useSetSavedMoves();
  const ctx = useCtx();
  const bg = useBackground();
  const { clearSelection } = useSetSelection();

  // Sorting by the server-assigned `seq` is what makes replay deterministic
  // across clients without needing OT or a CRDT: draw moves are additive, so
  // "same sorted order everywhere" is enough to converge on the same canvas.
  const sortedMoves = useMemo(() => {
    const { usersMoves, movesWithoutUser, myMoves } = room;

    const moves = [...movesWithoutUser, ...myMoves];

    usersMoves.forEach((userMoves) => moves.push(...userMoves));

    /**
     * Order by the server's sequence, which every client receives identically.
     * `timestamp` came from `Date.now()` on whichever machine drew the stroke,
     * so two clients could sort overlapping strokes differently and render
     * different pictures. It stays as the fallback for moves that have not
     * been through the server, which sort with seq 0.
     */
    moves.sort((a, b) => {
      if (a.seq && b.seq) return a.seq - b.seq;

      return a.timestamp - b.timestamp;
    });

    return moves;
  }, [room]);

  const copyCanvasToSmall = useCallback(() => {
    if (canvasRef.current && minimapRef.current && bgRef.current) {
      const smallCtx = minimapRef.current.getContext('2d');
      if (smallCtx) {
        smallCtx.clearRect(0, 0, smallCtx.canvas.width, smallCtx.canvas.height);
        smallCtx.drawImage(
          bgRef.current,
          0,
          0,
          smallCtx.canvas.width,
          smallCtx.canvas.height,
        );
        smallCtx.drawImage(
          canvasRef.current,
          0,
          0,
          smallCtx.canvas.width,
          smallCtx.canvas.height,
        );
      }
    }
    // Refs are stable across renders, so this never needs to be recreated.
  }, [canvasRef, minimapRef, bgRef]);

  useEffect(() => copyCanvasToSmall(), [bg, copyCanvasToSmall]);

  const drawMove = (move: Move, image?: HTMLImageElement) => {
    const { path } = move;

    if (!ctx || !path.length) return;

    const moveOptions = move.options;

    if (moveOptions.mode === 'select') return;

    ctx.lineWidth = moveOptions.lineWidth;
    ctx.strokeStyle = getStringFromRgba(moveOptions.lineColor);
    ctx.fillStyle = getStringFromRgba(moveOptions.fillColor);
    if (moveOptions.mode === 'eraser')
      ctx.globalCompositeOperation = 'destination-out';
    else ctx.globalCompositeOperation = 'source-over';

    if (moveOptions.shape === 'image' && image)
      ctx.drawImage(image, path[0][0], path[0][1]);

    switch (moveOptions.shape) {
      case 'line': {
        ctx.beginPath();
        path.forEach(([x, y]) => {
          ctx.lineTo(x, y);
        });

        ctx.stroke();
        ctx.closePath();
        break;
      }

      case 'circle': {
        const { cX, cY, radiusX, radiusY } = move.circle;

        ctx.beginPath();
        ctx.ellipse(cX, cY, radiusX, radiusY, 0, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.fill();
        ctx.closePath();
        break;
      }

      case 'rect': {
        const { width, height } = move.rect;

        ctx.beginPath();

        ctx.rect(path[0][0], path[0][1], width, height);
        ctx.stroke();
        ctx.fill();

        ctx.closePath();
        break;
      }

      default:
        break;
    }

    copyCanvasToSmall();
  };

  const drawAllMoves = async () => {
    if (!ctx) return;

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    const images = await Promise.all(
      sortedMoves
        .filter((move) => move.options.shape === 'image')
        .map(
          (move) =>
            new Promise<HTMLImageElement>((resolve) => {
              const img = new Image();
              img.src = move.img.base64;
              img.id = move.id;
              img.addEventListener('load', () => resolve(img));
            }),
        ),
    );

    sortedMoves.forEach((move) => {
      if (move.options.shape === 'image') {
        const img = images.find((image) => image.id === move.id);
        if (img) drawMove(move, img);
      } else drawMove(move);
    });

    copyCanvasToSmall();
  };

  useSelection(drawAllMoves);

  useEffect(() => {
    socket.on('your_move', (move) => {
      clearOnYourMove();
      handleAddMyMove(move);
      setTimeout(clearSelection, 100);
    });

    return () => {
      socket.off('your_move');
    };
  }, [clearOnYourMove, clearSelection, handleAddMyMove]);

  useEffect(() => {
    if (prevMovesLength >= sortedMoves.length || !prevMovesLength) {
      drawAllMoves();
    } else {
      const lastMove = sortedMoves[sortedMoves.length - 1];

      if (lastMove.options.shape === 'image') {
        const img = new Image();
        img.src = lastMove.img.base64;
        img.addEventListener('load', () => drawMove(lastMove, img));
      } else drawMove(lastMove);
    }

    return () => {
      prevMovesLength = sortedMoves.length;
    };

    // Intentionally scoped to `sortedMoves` only: this compares the new move count against
    // `prevMovesLength` to decide full-redraw vs. incremental-draw. drawAllMoves/drawMove are
    // recreated every render (they close over ctx), so including them would redraw on every
    // unrelated render, not just when new moves arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedMoves]);

  const handleUndo = useCallback(() => {
    if (ctx) {
      const move = handleRemoveMyMove();

      if (move?.options.mode === 'select') clearSelection();
      else if (move) {
        addSavedMove(move);
        socket.emit('undo');
      }
    }
  }, [ctx, handleRemoveMyMove, clearSelection, addSavedMove]);

  const handleRedo = useCallback(() => {
    if (ctx) {
      const move = removeSavedMove();

      if (move) {
        // A fresh clientId: this is a new move as far as the server is
        // concerned, and reusing the old one would be dropped as a duplicate.
        socket.emit('draw', { ...move, clientId: v4() });
      }
    }
  }, [ctx, removeSavedMove]);

  useEffect(() => {
    const handleUndoRedoKeyboard = (e: KeyboardEvent) => {
      // Never steal a keystroke from a text field: undo there means undo the
      // typing, not the drawing.
      if (isTypingTarget(e.target)) return;

      // Redo first: Cmd+Shift+Z would otherwise also satisfy undo.
      if (isRedo(e)) {
        e.preventDefault();
        handleRedo();
      } else if (isUndo(e)) {
        e.preventDefault();
        handleUndo();
      }
    };

    document.addEventListener('keydown', handleUndoRedoKeyboard);

    return () => {
      document.removeEventListener('keydown', handleUndoRedoKeyboard);
    };
  }, [handleUndo, handleRedo]);

  return { handleUndo, handleRedo };
};
