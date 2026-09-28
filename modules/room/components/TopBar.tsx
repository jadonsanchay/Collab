import { Share2 } from 'lucide-react';

import HotkeyTooltip from '@/common/components/HotkeyTooltip';

import { useToolbarActionsContext } from '../modules/toolbar/context/ToolbarActions.context';
import UserList from './UserList';

/**
 * Board name is a placeholder until Phase 3 adds persistence and a real
 * name to edit.
 */
const TopBar = () => {
  const { handleShare } = useToolbarActionsContext();

  return (
    <div className="fixed left-0 top-0 z-40 flex w-full items-center justify-between p-3">
      <span className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-semibold text-white">
        Untitled board
      </span>

      <div className="flex items-center gap-3">
        <UserList />

        <HotkeyTooltip label="Share">
          <button
            type="button"
            aria-label="Share"
            className="btn-icon bg-zinc-900 text-white"
            onClick={handleShare}
          >
            <Share2 />
          </button>
        </HotkeyTooltip>
      </div>
    </div>
  );
};

export default TopBar;
