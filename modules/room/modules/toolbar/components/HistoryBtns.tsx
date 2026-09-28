import { Redo2, Undo2 } from 'lucide-react';

import HotkeyTooltip from '@/common/components/HotkeyTooltip';
import { useMyMoves } from '@/common/store/room.store';
import { useSavedMoves } from '@/common/store/history.store';

import { useRefs } from '../../../hooks/useRefs';

const HistoryBtns = () => {
  const { redoRef, undoRef } = useRefs();

  const { myMoves } = useMyMoves();
  const savedMoves = useSavedMoves();

  return (
    <>
      <HotkeyTooltip label="Undo" hotkey="⌘Z">
        <button
          type="button"
          className="btn-icon"
          aria-label="Undo"
          ref={undoRef}
          disabled={!myMoves.length}
        >
          <Undo2 />
        </button>
      </HotkeyTooltip>
      <HotkeyTooltip label="Redo" hotkey="⌘⇧Z">
        <button
          type="button"
          className="btn-icon"
          aria-label="Redo"
          ref={redoRef}
          disabled={!savedMoves.length}
        >
          <Redo2 />
        </button>
      </HotkeyTooltip>
    </>
  );
};

export default HistoryBtns;
