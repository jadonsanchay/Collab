import { useCallback, useEffect, useMemo, useRef } from 'react';

import { v4 } from 'uuid';

import { isRedo, isTypingTarget, isUndo } from '@/common/lib/keyboard';
import { socket } from '@/common/lib/socket';
import { useBackground } from '@/common/store/background.store';
import { useSetSelection } from '@/common/store/options.store';
import { useMyMoves, useRoom } from '@/common/store/room.store';
import { useSetSavedMoves } from '@/common/store/history.store';

import { CommittedRenderer } from '../render/CommittedRenderer';
import { useCtx } from '../modules/board/hooks/useCtx';
import { useRefs } from './useRefs';
import { useSelection } from '../modules/board/hooks/useSelection';

export const useMovesHandlers = () => {
  const { canvasRef, minimapRef, bgRef } = useRefs();
  const room = useRoom();
  const { handleAddMyMove, handleRemoveMyMove } = useMyMoves();
  const { addSavedMove, removeSavedMove } = useSetSavedMoves();
  const ctx = useCtx();
  const bg = useBackground();
  const { clearSelection } = useSetSelection();

  const rendererRef = useRef<CommittedRenderer | null>(null);

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

  useEffect(() => {
    if (!ctx) return undefined;

    rendererRef.current = new CommittedRenderer(ctx, copyCanvasToSmall);

    return () => {
      rendererRef.current = null;
    };
    // A fresh renderer per `ctx` instance keeps its own image cache and
    // checkpoint scoped to the canvas it owns.
  }, [ctx, copyCanvasToSmall]);

  useSelection();

  useEffect(() => {
    socket.on('your_move', (move) => {
      handleAddMyMove(move);
      setTimeout(clearSelection, 100);
    });

    return () => {
      socket.off('your_move');
    };
  }, [clearSelection, handleAddMyMove]);

  useEffect(() => {
    rendererRef.current?.schedule(sortedMoves);
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
