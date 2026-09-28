import { useEffect, useMemo, useRef, useState } from 'react';

import { motion, useMotionValue } from 'framer-motion';

import { CANVAS_SIZE } from '@/common/constants/canvasSize';
import { useViewportSize } from '@/common/hooks/useViewportSize';
import { useViewportStore } from '@/common/store/viewport.store';

import { useRefs } from '../../../hooks/useRefs';

const MiniMap = ({ dragging }: { dragging: boolean }) => {
  const { minimapRef } = useRefs();
  const x = useViewportStore((state) => state.x);
  const y = useViewportStore((state) => state.y);
  const scale = useViewportStore((state) => state.scale);
  const { width, height } = useViewportSize();

  const [draggingMinimap, setDraggingMinimap] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  const miniX = useMotionValue(0);
  const miniY = useMotionValue(0);

  const divider = useMemo(() => {
    if (width > 1600) return 7;
    if (width > 1000) return 10;
    if (width > 600) return 14;
    return 20;
  }, [width]);

  useEffect(() => {
    const handleMiniXChange = (newX: number) => {
      if (!dragging)
        useViewportStore.setState({ x: Math.floor(-newX * divider * scale) });
    };

    const handleMiniYChange = (newY: number) => {
      if (!dragging)
        useViewportStore.setState({ y: Math.floor(-newY * divider * scale) });
    };

    const unsubscribeX = miniX.on('change', handleMiniXChange);
    const unsubscribeY = miniY.on('change', handleMiniYChange);

    return () => {
      unsubscribeX();
      unsubscribeY();
    };
  }, [divider, dragging, miniX, miniY, scale]);

  return (
    <div
      className="absolute right-10 top-10 z-30 overflow-hidden rounded-lg shadow-lg"
      style={{
        width: CANVAS_SIZE.width / divider,
        height: CANVAS_SIZE.height / divider,
      }}
      ref={containerRef}
    >
      <canvas
        ref={minimapRef}
        width={CANVAS_SIZE.width}
        height={CANVAS_SIZE.height}
        className="size-full"
      />
      <motion.div
        drag
        dragConstraints={containerRef}
        dragElastic={0}
        dragTransition={{ power: 0, timeConstant: 0 }}
        onDragStart={() => setDraggingMinimap(true)}
        onDragEnd={() => setDraggingMinimap(false)}
        className="absolute left-0 top-0 cursor-grab rounded-lg border-2 border-red-500"
        style={{
          width: width / divider / scale,
          height: height / divider / scale,
          x: miniX,
          y: miniY,
        }}
        animate={{ x: -x / divider / scale, y: -y / divider / scale }}
        transition={{ duration: 0 }}
      />
    </div>
  );
};

export default MiniMap;
