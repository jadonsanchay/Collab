import { type FormEvent, useEffect, useState } from 'react';

import { Eye, History, LayoutGrid, LogIn, Share2 } from 'lucide-react';
import Link from 'next/link';

import HotkeyTooltip from '@/common/components/HotkeyTooltip';
import { canDraw, canManage } from '@/common/constants/roles';
import { useFeatureFlag } from '@/common/hooks/useFeatureFlag';
import { socket } from '@/common/lib/socket';
import { MAX_TITLE_LENGTH, renameRoomSchema } from '@/common/schemas/events';
import { useHistoryStore } from '@/common/store/history.store';
import { useMyRole, useRoomTitle } from '@/common/store/room.store';
import { useIdentity } from '@/common/store/session.store';

import CallEntry from '../modules/call';
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

/** The board's name. Owners click it to rename; everyone else just reads it. */
const BoardTitle = () => {
  const title = useRoomTitle();
  const role = useMyRole();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);

  useEffect(() => {
    if (!editing) setDraft(title);
  }, [title, editing]);

  if (!canManage(role)) {
    return (
      <span className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-semibold text-white">
        {title}
      </span>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();

    const parsed = renameRoomSchema.safeParse(draft);

    if (parsed.success && parsed.data !== title) socket.emit('rename_room', parsed.data);

    setEditing(false);
  };

  if (!editing) {
    return (
      <HotkeyTooltip label="Rename board">
        <button
          type="button"
          aria-label="Rename board"
          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-zinc-700"
          onClick={() => setEditing(true)}
        >
          {title}
        </button>
      </HotkeyTooltip>
    );
  }

  return (
    <form onSubmit={submit}>
      <input
        aria-label="Board title"
        className="rounded-lg border border-zinc-400 bg-white px-3 py-1.5 text-sm font-semibold"
        value={draft}
        maxLength={MAX_TITLE_LENGTH}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- the user just asked to edit this
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        onBlur={submit}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setDraft(title);
            setEditing(false);
          }
        }}
      />
    </form>
  );
};

/** Sign in, or who is signed in with a way out. Only where sign-in exists. */
const AccountButton = () => {
  const auth = useFeatureFlag('auth');
  const identity = useIdentity();

  if (!auth) return null;

  if (!identity || identity.isGuest) {
    return (
      // eslint-disable-next-line @next/next/no-html-link-for-pages -- an Express route, not a page
      <a
        href="/api/auth/signin"
        className="flex items-center gap-1 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-semibold text-white"
      >
        <LogIn className="size-4" /> Sign in
      </a>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg bg-zinc-900 px-2 py-1 text-sm text-white">
      {identity.image ? (
        // eslint-disable-next-line @next/next/no-img-element -- an avatar URL from the identity provider
        <img src={identity.image} alt="" className="size-6 rounded-full" />
      ) : null}
      <span className="max-w-32 truncate font-semibold">{identity.name ?? identity.email}</span>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- an Express route, not a page */}
      <a href="/api/auth/signout" className="text-xs underline opacity-80">
        Sign out
      </a>
    </div>
  );
};

const TopBar = () => {
  const { handleShare } = useToolbarActionsContext();
  const persistent = useFeatureFlag('persistent');
  const rtc = useFeatureFlag('rtc');
  const role = useMyRole();

  return (
    <div className="fixed left-0 top-0 z-40 flex w-full items-center justify-between p-3">
      <div className="flex items-center gap-2">
        {persistent && (
          <HotkeyTooltip label="My boards">
            <Link href="/boards" aria-label="My boards" className="btn-icon bg-zinc-900 text-white">
              <LayoutGrid />
            </Link>
          </HotkeyTooltip>
        )}
        <BoardTitle />
        {!canDraw(role) && (
          <span className="flex items-center gap-1 rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-900">
            <Eye className="size-3" /> View only
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <UserList />

        {rtc && <CallEntry />}

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

        <AccountButton />
      </div>
    </div>
  );
};

export default TopBar;
