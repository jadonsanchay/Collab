import { History, Share2 } from 'lucide-react';

import HotkeyTooltip from '@/common/components/HotkeyTooltip';
import { useFeatureFlag } from '@/common/hooks/useFeatureFlag';
import { useHistoryStore } from '@/common/store/history.store';

import { useToolbarActionsContext } from '../modules/toolbar/context/ToolbarActions.context';
import UserList from './UserList';

const RewindToggle = () => {
  const enabled = useFeatureFlag('rewind');
  const open = useHistoryStore((state) => state.view.panelOpen);
  const setPanelOpen = useHistoryStore((state) => state.setPanelOpen);
  const goLive = useHistoryStore((state) => state.goLive);

  if (!enabled) return null;

  return (
    <HotkeyTooltip label="Rewind" hotkey="⌘⇧H">
      <button
        type="button"
        aria-label="Rewind"
        aria-pressed={open}
        className={`btn-icon ${open ? 'bg-amber-500 text-black' : 'bg-zinc-900 text-white'}`}
        onClick={() => {
          if (open) goLive();
          setPanelOpen(!open);
        }}
      >
        <History />
      </button>
    </HotkeyTooltip>
  );
};

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

        <RewindToggle />

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
