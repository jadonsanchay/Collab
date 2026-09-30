import { useCallback, useEffect, useMemo, useRef } from 'react';

import { v4 } from 'uuid';

import { isRedo, isTypingTarget, isUndo } from '@/common/lib/keyboard';
import { socket } from '@/common/lib/socket';
import { sortMoves, visibleMoves } from '@/common/render/historyView';
import { useBackground } from '@/common/store/background.store';
import { useSetSelection } from '@/common/store/options.store';
import { useMyMoves, useRoom } from '@/common/store/room.store';
import {
  isViewingHistory,
  useHistoryView,
  useSetSavedMoves,
} from '@/common/store/history.store';

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
  const view = useHistoryView();

  // Sorting by the server-assigned `seq` is what makes replay deterministic
  // across clients without needing OT or a CRDT: draw moves are additive, so
  // "same sorted order everywhere" is enough to converge on the same canvas.
  const sortedMoves = useMemo(() => sortMoves(room), [room]);

  /**
   * What the committed canvas shows. Live, this is every move. While Rewind
   * is open it is the prefix up to the cursor, filtered by author. The
   * renderer's checkpoint makes scrubbing forward an append and scrubbing
   * back past the checkpoint a full replay; live moves that arrive
   * meanwhile are stored as usual and appear on return to live.
   */
  const shownMoves = useMemo(() => visibleMoves(sortedMoves, view), [sortedMoves, view]);

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
    rendererRef.current?.schedule(shownMoves);
  }, [shownMoves]);

  const handleUndo = useCallback(() => {
    // The past is read-only: undoing while scrubbed back would remove a move
    // the user cannot even see.
    if (isViewingHistory()) return;

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
    if (isViewingHistory()) return;

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
