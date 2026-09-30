import { useCallback, useState } from 'react';

import { toast } from 'sonner';

import { CANVAS_SIZE } from '@/common/constants/canvasSize';
import { drawMove, type ImageCache, preloadImages } from '@/common/render/drawMove';
import { sortMoves, visibleMoves } from '@/common/render/historyView';
import { useHistoryStore } from '@/common/store/history.store';
import { useRoomStore } from '@/common/store/room.store';

import { useRefs } from '../../../hooks/useRefs';

/** Export resolution: half the board, plenty for a timelapse, quick to encode. */
const EXPORT_SCALE = 0.5;
/** Frames the whole export aims for, at 30 per second: about ten seconds. */
const TARGET_FRAMES = 300;
const FPS = 30;
/** Held frames at the start and end so the video does not begin or end mid-stroke. */
const HOLD_FRAMES = 15;

/** Safari has neither; the button is disabled with an explanation there. */
export const canExportTimelapse = () =>
  typeof window !== 'undefined' &&
  typeof MediaRecorder !== 'undefined' &&
  typeof HTMLCanvasElement !== 'undefined' &&
  'captureStream' in HTMLCanvasElement.prototype;

const pickMimeType = () =>
  ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((type) =>
    MediaRecorder.isTypeSupported(type),
  ) ?? 'video/webm';

const nextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });

/**
 * Renders the board's history frame by frame onto an offscreen canvas while
 * a `MediaRecorder` captures it, then downloads the WebM. Client-side only:
 * no server involvement, so it works for any board the client can see.
 *
 * Draw moves are additive (erasers included: they are `destination-out`
 * draws), so each frame only appends the next few moves instead of
 * replaying from scratch.
 */
export const useTimelapseExport = () => {
  const { bgRef } = useRefs();
  const [exporting, setExporting] = useState(false);

  const exportTimelapse = useCallback(async () => {
    if (!canExportTimelapse() || exporting) return;

    const { room } = useRoomStore.getState();
    const { userFilter } = useHistoryStore.getState().view;
    const moves = visibleMoves(sortMoves(room), { cursorSeq: null, userFilter });

    if (!moves.length) {
      toast('Nothing to export yet.');
      return;
    }

    setExporting(true);

    try {
      const ink = document.createElement('canvas');
      ink.width = CANVAS_SIZE.width;
      ink.height = CANVAS_SIZE.height;
      const inkCtx = ink.getContext('2d');

      const out = document.createElement('canvas');
      out.width = Math.round(CANVAS_SIZE.width * EXPORT_SCALE);
      out.height = Math.round(CANVAS_SIZE.height * EXPORT_SCALE);
      const outCtx = out.getContext('2d');

      if (!inkCtx || !outCtx) throw new Error('canvas unavailable');

      inkCtx.lineCap = 'round';
      inkCtx.lineJoin = 'round';

      const cache: ImageCache = new Map();
      await preloadImages(moves, cache);

      const compose = () => {
        outCtx.clearRect(0, 0, out.width, out.height);
        if (bgRef.current) outCtx.drawImage(bgRef.current, 0, 0, out.width, out.height);
        outCtx.drawImage(ink, 0, 0, out.width, out.height);
      };

      const stream = out.captureStream(FPS);
      const recorder = new MediaRecorder(stream, { mimeType: pickMimeType() });
      const chunks: Blob[] = [];

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size) chunks.push(event.data);
      });

      const stopped = new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true });
      });

      recorder.start();

      const movesPerFrame = Math.max(1, Math.ceil(moves.length / TARGET_FRAMES));
      let index = 0;

      const hold = async (frames: number) => {
        for (let i = 0; i < frames; i += 1) {
          compose();
          // Frame pacing: one composite per animation frame is what the
          // capture stream samples, so this is a timer, not a busy loop.
          // eslint-disable-next-line no-await-in-loop
          await nextFrame();
        }
      };

      await hold(HOLD_FRAMES);

      while (index < moves.length) {
        for (let i = 0; i < movesPerFrame && index < moves.length; i += 1) {
          drawMove(inkCtx, moves[index], cache);
          index += 1;
        }

        compose();
        // eslint-disable-next-line no-await-in-loop
        await nextFrame();
      }

      await hold(HOLD_FRAMES);

      recorder.stop();
      await stopped;

      const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `collab-${room.id || 'board'}.webm`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

      toast.success('Timelapse exported.');
    } catch (error) {
      toast.error('The timelapse could not be exported.');
      // eslint-disable-next-line no-console -- the browser console is the only sink on the client
      console.error('timelapse export failed', error);
    } finally {
      setExporting(false);
    }
  }, [bgRef, exporting]);

  return { exportTimelapse, exporting, supported: canExportTimelapse() };
};
