import { useEffect, useState } from 'react';

import { AiOutlineDelete } from 'react-icons/ai';
import { BsArrowsMove } from 'react-icons/bs';
import { FiCopy } from 'react-icons/fi';

import { useOptionsValue } from '@/common/store/options.store';

import { useRefs } from '../../../hooks/useRefs';
import { useBoardPosition } from '../hooks/useBoardPosition';

const SelectionBtns = () => {
  const { selection } = useOptionsValue();
  const { selectionRefs } = useRefs();
  const boardPos = useBoardPosition();

  const [boardX, setX] = useState(0);
  const [boardY, setY] = useState(0);

  useEffect(() => {
    const unsubscribe = boardPos.x.on('change', setX);
    return unsubscribe;
  }, [boardPos.x]);

  useEffect(() => {
    const unsubscribe = boardPos.y.on('change', setY);
    return unsubscribe;
  }, [boardPos.y]);

  let top = -40;
  let left = -40;

  if (selection) {
    const { x, y, width, height } = selection;
    top = Math.min(y, y + height) - 40 + boardY;
    left = Math.min(x, x + width) + boardX;
  }

  return (
    <div
      className="absolute left-0 top-0 z-50 flex items-center justify-center gap-2"
      style={{ top, left }}
    >
      <button
        type="button"
        className="rounded-full bg-gray-200 p-2"
        ref={(ref) => {
          if (ref && selectionRefs.current) selectionRefs.current[0] = ref;
        }}
      >
        <BsArrowsMove />
      </button>
      <button
        type="button"
        className="rounded-full bg-gray-200 p-2"
        ref={(ref) => {
          if (ref && selectionRefs.current) selectionRefs.current[1] = ref;
        }}
      >
        <FiCopy />
      </button>
      <button
        type="button"
        className="rounded-full bg-gray-200 p-2"
        ref={(ref) => {
          if (ref && selectionRefs.current) selectionRefs.current[2] = ref;
        }}
      >
        <AiOutlineDelete />
      </button>
    </div>
  );
};

export default SelectionBtns;
