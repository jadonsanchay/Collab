import { useCallback, useEffect, useMemo } from 'react';

import { toast } from 'react-toastify';

import { DEFAULT_MOVE } from '@/common/constants/defaultMove';
import { isCopy, isDelete, isTypingTarget } from '@/common/lib/keyboard';
import { socket } from '@/common/lib/socket';
import { useOptionsValue } from '@/common/recoil/options';
import { MAX_IMAGE_BASE64_LENGTH } from '@/common/schemas/move';
import { Move } from '@/common/types/global';

import { useMoveImage } from '../../../hooks/useMoveImage';
import { useRefs } from '../../../hooks/useRefs';
import { useCtx } from './useCtx';

let tempSelection = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
};

export const useSelection = (drawAllMoves: () => Promise<void>) => {
  const ctx = useCtx();
  const options = useOptionsValue();
  const { selection } = options;
  const { bgRef, selectionRefs } = useRefs();
  const { setMoveImage } = useMoveImage();

  useEffect(() => {
    const callback = async () => {
      await drawAllMoves();

      if (ctx && selection) {
        setTimeout(() => {
          const { x, y, width, height } = selection;

          ctx.lineWidth = 2;
          ctx.strokeStyle = '#000';
          ctx.setLineDash([5, 10]);
          ctx.globalCompositeOperation = 'source-over';

          ctx.beginPath();
          ctx.rect(x, y, width, height);
          ctx.stroke();
          ctx.closePath();

          ctx.setLineDash([]);
        }, 10);
      }
    };

    if (
      tempSelection.width !== selection?.width ||
      tempSelection.height !== selection?.height ||
      tempSelection.x !== selection?.x ||
      tempSelection.y !== selection?.y
    )
      callback();

    return () => {
      if (selection) tempSelection = selection;
    };

    // drawAllMoves is passed in fresh every render (not memoized by the caller), so including
    // it here would redraw on every unrelated render instead of only on selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, ctx]);

  const dimension = useMemo(() => {
    if (selection) {
      let { x, y, width, height } = selection;

      if (width < 0) {
        width += 4;
        x -= 2;
      } else {
        width -= 4;
        x += 2;
      }
      if (height < 0) {
        height += 4;
        y -= 2;
      } else {
        height -= 4;
        y += 2;
      }

      return { x, y, width, height };
    }

    return {
      width: 0,
      height: 0,
      x: 0,
      y: 0,
    };
  }, [selection]);

  const makeBlob = useCallback(
    async (withBg?: boolean) => {
      if (!selection) return null;

      const { x, y, width, height } = dimension;

      const imageData = ctx?.getImageData(x, y, width, height);

      if (imageData) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const tempCtx = canvas.getContext('2d');

        if (tempCtx && bgRef.current) {
          const bgImage = bgRef.current
            .getContext('2d')
            ?.getImageData(x, y, width, height);

          if (bgImage && withBg) tempCtx.putImageData(bgImage, 0, 0);

          const sTempCtx = tempCanvas.getContext('2d');
          sTempCtx?.putImageData(imageData, 0, 0);

          tempCtx.drawImage(tempCanvas, 0, 0);

          const blob: Blob = await new Promise((resolve) => {
            // WEBP at 0.8 rather than the default full-resolution PNG. A
            // selection of any size used to produce megabytes of base64,
            // which the server now refuses; this is typically 5 to 20 times
            // smaller and matches what the image picker already uses.
            canvas.toBlob(
              (blobGenerated) => {
                if (blobGenerated) resolve(blobGenerated);
              },
              'image/webp',
              0.8,
            );
          });

          return blob;
        }
      }

      return null;
    },
    [selection, dimension, ctx, bgRef],
  );

  const createDeleteMove = useCallback(() => {
    if (!selection) return null;

    let { x, y, width, height } = dimension;

    if (width < 0) {
      width += 4;
      x -= 2;
    } else {
      width -= 4;
      x += 2;
    }
    if (height < 0) {
      height += 4;
      y -= 2;
    } else {
      height -= 4;
      y += 2;
    }

    const move: Move = {
      ...DEFAULT_MOVE,
      rect: {
        width,
        height,
      },
      path: [[x, y]],
      options: {
        ...options,
        shape: 'rect',
        mode: 'eraser',
        fillColor: { r: 0, g: 0, b: 0, a: 1 },
      },
    };

    socket.emit('draw', move);

    return move;
  }, [selection, dimension, options]);

  const handleCopy = useCallback(async () => {
    const blob = await makeBlob(true);

    if (blob)
      navigator.clipboard
        .write([
          new ClipboardItem({
            'image/png': blob,
          }),
        ])
        .then(() => {
          toast('Copied to clipboard!', {
            position: 'top-center',
            theme: 'colored',
          });
        });
  }, [makeBlob]);

  useEffect(() => {
    const handleSelection = async (e: KeyboardEvent) => {
      // Both of these used to fire while typing, so a "c" in the chat box
      // copied the board and Delete erased pixels mid-sentence.
      if (isTypingTarget(e.target)) return;

      // Only intercept copy when there is actually something selected;
      // otherwise Cmd+C should copy whatever the browser would.
      if (selection && isCopy(e)) {
        e.preventDefault();
        handleCopy();
      }

      if (selection && isDelete(e)) {
        e.preventDefault();
        createDeleteMove();
      }
    };

    document.addEventListener('keydown', handleSelection);

    return () => {
      document.removeEventListener('keydown', handleSelection);
    };
  }, [bgRef, createDeleteMove, ctx, handleCopy, makeBlob, options, selection]);

  useEffect(() => {
    const handleSelectionMove = async () => {
      if (selection) {
        const blob = await makeBlob();
        if (!blob) return;

        const { x, y, width, height } = dimension;

        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.addEventListener('loadend', () => {
          const base64 = reader.result?.toString();

          if (!base64) return;

          /**
           * Checked before anything is erased. The delete lands now, but the
           * image is only sent when the user drops it, so a payload the server
           * would reject has to be caught here — otherwise the selected pixels
           * are gone and nothing ever comes back to replace them.
           */
          if (base64.length > MAX_IMAGE_BASE64_LENGTH) {
            toast('That selection is too large to move.', {
              position: 'top-center',
              theme: 'colored',
              type: 'warning',
            });

            return;
          }

          createDeleteMove();
          setMoveImage({
            base64,
            x: Math.min(x, x + width),
            y: Math.min(y, y + height),
          });
        });
      }
    };

    if (selectionRefs.current) {
      const moveBtn = selectionRefs.current[0];
      const copyBtn = selectionRefs.current[1];
      const deleteBtn = selectionRefs.current[2];

      moveBtn.addEventListener('click', handleSelectionMove);
      copyBtn.addEventListener('click', handleCopy);
      deleteBtn.addEventListener('click', createDeleteMove);

      return () => {
        moveBtn?.removeEventListener('click', handleSelectionMove);
        copyBtn?.removeEventListener('click', handleCopy);
        deleteBtn?.removeEventListener('click', createDeleteMove);
      };
    }

    return () => {};
  }, [
    createDeleteMove,
    dimension,
    handleCopy,
    makeBlob,
    selection,
    selectionRefs,
    setMoveImage,
  ]);
};
