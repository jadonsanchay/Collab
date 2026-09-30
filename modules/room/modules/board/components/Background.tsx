import { RefObject, useEffect } from 'react';

import { CANVAS_SIZE } from '@/common/constants/canvasSize';
import { drawBackground } from '@/common/render/drawBackground';
import { useBackground } from '@/common/store/background.store';

const Background = ({
  bgRef,
}: {
  bgRef: RefObject<HTMLCanvasElement | null>;
}) => {
  const bg = useBackground();

  useEffect(() => {
    const ctx = bgRef.current?.getContext('2d');

    if (ctx) {
      drawBackground(ctx, CANVAS_SIZE.width, CANVAS_SIZE.height, bg);

      document.body.style.backgroundColor =
        bg.mode === 'dark' ? '#222' : '#fff';
    }
  }, [bgRef, bg]);

  return (
    <canvas
      ref={bgRef}
      width={CANVAS_SIZE.width}
      height={CANVAS_SIZE.height}
      className="absolute top-0 bg-zinc-100"
    />
  );
};

export default Background;
