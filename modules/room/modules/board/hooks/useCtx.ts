import { RefObject, useEffect, useState } from 'react';

import { useRefs } from '../../../hooks/useRefs';

const useCanvasCtx = (ref: RefObject<HTMLCanvasElement | null>) => {
  const [ctx, setCtx] = useState<CanvasRenderingContext2D>();

  useEffect(() => {
    const newCtx = ref.current?.getContext('2d');

    if (newCtx) {
      newCtx.lineJoin = 'round';
      newCtx.lineCap = 'round';
      setCtx(newCtx);
    }
  }, [ref]);

  return ctx;
};

export const useCtx = () => {
  const { canvasRef } = useRefs();

  return useCanvasCtx(canvasRef);
};

export const useLiveCtx = () => {
  const { liveRef } = useRefs();

  return useCanvasCtx(liveRef);
};

export const useRemoteLiveCtx = () => {
  const { remoteLiveRef } = useRefs();

  return useCanvasCtx(remoteLiveRef);
};
