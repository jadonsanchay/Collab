import { FaRedo, FaUndo } from 'react-icons/fa';

import { useMyMoves } from '@/common/store/room.store';
import { useSavedMoves } from '@/common/store/history.store';

import { useRefs } from '../../../hooks/useRefs';

const HistoryBtns = () => {
  const { redoRef, undoRef } = useRefs();

  const { myMoves } = useMyMoves();
  const savedMoves = useSavedMoves();

  return (
    <>
      <button
        type="button"
        className="btn-icon text-xl"
        ref={redoRef}
        disabled={!savedMoves.length}
      >
        <FaRedo />
      </button>
      <button
        type="button"
        className="btn-icon text-xl"
        ref={undoRef}
        disabled={!myMoves.length}
      >
        <FaUndo />
      </button>
    </>
  );
};

export default HistoryBtns;
