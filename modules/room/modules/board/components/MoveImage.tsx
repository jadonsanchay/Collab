import { useEffect } from 'react';

import { motion, useMotionValue } from 'framer-motion';
import { AiOutlineCheck, AiOutlineClose } from 'react-icons/ai';

import { v4 } from 'uuid';

import { DEFAULT_MOVE } from '@/common/constants/defaultMove';
import { toBoard } from '@/common/lib/coords';
import { socket } from '@/common/lib/socket';
import { useViewportStore } from '@/common/store/viewport.store';
import { Move } from '@/common/types/global';

import { useMoveImage } from '../../../hooks/useMoveImage';

const MoveImage = () => {
  const x = useViewportStore((state) => state.x);
  const y = useViewportStore((state) => state.y);
  const scale = useViewportStore((state) => state.scale);
  const { moveImage, setMoveImage } = useMoveImage();

  const imageX = useMotionValue(moveImage.x || 50);
  const imageY = useMotionValue(moveImage.y || 50);

  useEffect(() => {
    if (moveImage.x) imageX.set(moveImage.x);
    else imageX.set(50);
    if (moveImage.y) imageY.set(moveImage.y);
    else imageY.set(50);
  }, [imageX, imageY, moveImage.x, moveImage.y]);

  const handlePlaceImage = () => {
    const [finalX, finalY] = [
      toBoard(imageX.get(), x, scale),
      toBoard(imageY.get(), y, scale),
    ];

    const move: Move = {
      ...DEFAULT_MOVE,
      // Identifies this move across a resend, so a retry is recognised by the
      // server instead of drawn twice.
      clientId: v4(),
      img: { base64: moveImage.base64 },
      path: [[finalX, finalY]],
      options: {
        ...DEFAULT_MOVE.options,
        selection: null,
        shape: 'image',
      },
    };

    socket.emit('draw', move);

    setMoveImage({ base64: '' });
    imageX.set(50);
    imageY.set(50);
  };

  if (!moveImage.base64) return null;

  return (
    <motion.div
      drag
      dragElastic={0}
      dragTransition={{ power: 0.03, timeConstant: 50 }}
      className="absolute top-0 z-20 cursor-grab"
      style={{ x: imageX, y: imageY }}
    >
      <div className="absolute bottom-full mb-2 flex gap-3">
        <button
          type="button"
          className="rounded-full bg-gray-200 p-2"
          onClick={handlePlaceImage}
        >
          <AiOutlineCheck />
        </button>
        <button
          type="button"
          className="rounded-full bg-gray-200 p-2"
          onClick={() => setMoveImage({ base64: '' })}
        >
          <AiOutlineClose />
        </button>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- pasted images are base64 data URIs with no known dimensions, so next/image isn't applicable */}
      <img
        className="pointer-events-none"
        alt="pending placement on the board"
        src={moveImage.base64}
      />
    </motion.div>
  );
};

export default MoveImage;
