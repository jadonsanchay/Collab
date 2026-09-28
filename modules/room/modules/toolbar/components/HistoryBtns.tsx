import { Redo2, Undo2 } from 'lucide-react';

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
        <Redo2 />
      </button>
      <button
        type="button"
        className="btn-icon text-xl"
        ref={undoRef}
        disabled={!myMoves.length}
      >
        <Undo2 />
      </button>
    </>
  );
};

export default HistoryBtns;
