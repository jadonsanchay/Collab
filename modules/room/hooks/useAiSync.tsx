import { useEffect } from 'react';

import { toast } from 'sonner';

import { socket } from '@/common/lib/socket';
import { useAiStore } from '@/common/store/ai.store';
import type { AiStatusUpdate } from '@/common/types/global';

import { undoSketch } from '../lib/ai';

/**
 * Keeps `ai.store` in step with the room's `ai_status` broadcasts and turns
 * the outcomes of this client's own requests into toasts. Everyone sees
 * Sketch's status on its avatar and cursor; only the requester gets the
 * toast and the "Undo Sketch" action.
 */
export const useAiSync = () => {
  useEffect(() => {
    const handleStatus = (update: AiStatusUpdate) => {
      const { mine, applyStatus } = useAiStore.getState();

      applyStatus(update);

      if (!mine.has(update.requestId)) return;

      switch (update.status) {
        case 'done':
          toast.success(update.message || 'Sketch is done.', {
            duration: 10_000,
            action: {
              label: 'Undo Sketch',
              onClick: () => undoSketch(update.requestId),
            },
          });
          break;

        case 'refused':
          toast.warning(update.message ?? 'Sketch decided not to draw that.');
          break;

        case 'rate_limited':
          toast.warning(update.message ?? 'Sketch is busy. Try again shortly.');
          break;

        case 'error':
          toast.error(update.message ?? 'Sketch ran into a problem.');
          break;

        default:
          break;
      }
    };

    socket.on('ai_status', handleStatus);

    return () => {
      socket.off('ai_status', handleStatus);
    };
  }, []);
};
