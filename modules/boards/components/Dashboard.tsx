import { type FormEvent, useCallback, useEffect, useState } from 'react';

import { Copy, LayoutGrid, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { toast } from 'sonner';

import { canManage, type Role } from '@/common/constants/roles';
import { getMyUserId } from '@/common/lib/identity';
import type { Identity } from '@/common/types/global';

type BoardCard = {
  id: string;
  title: string;
  role: Role;
  visibility: string;
  thumbnailUrl: string | null;
  lastActivityAt: number;
  starred: boolean;
};

type TemplateSummary = { id: string; name: string; description: string };

type Status = 'loading' | 'ready' | 'unavailable' | 'error';

const relativeTime = (timestamp: number) => {
  const minutes = Math.round((Date.now() - timestamp) / 60_000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;

  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
};

/** Makes sure the server knows this browser before asking for its boards. */
const ensureGuestCookie = () =>
  fetch('/api/me/guest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: getMyUserId() }),
  });

const Card = ({
  board,
  onStar,
  onRename,
  onDuplicate,
  onDelete,
}: {
  board: BoardCard;
  onStar: (board: BoardCard) => void;
  onRename: (board: BoardCard, title: string) => void;
  onDuplicate: (board: BoardCard) => void;
  onDelete: (board: BoardCard) => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(board.title);
  const [confirming, setConfirming] = useState(false);
  const owner = canManage(board.role);

  const submitRename = (event: FormEvent) => {
    event.preventDefault();
    setEditing(false);

    const title = draft.trim();
    if (title && title !== board.title) onRename(board, title);
  };

  return (
    <li className="flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <Link href={`/${board.id}`} className="block aspect-[2/1] bg-zinc-100">
        {board.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a thumbnail from our own storage
          <img src={board.thumbnailUrl} alt="" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-zinc-400">
            <LayoutGrid className="size-8" />
          </div>
        )}
      </Link>
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          {editing ? (
            <form onSubmit={submitRename} className="flex-1">
              <input
                aria-label="Board title"
                className="w-full rounded border px-2 py-1 text-sm font-semibold"
                value={draft}
                maxLength={80}
                // eslint-disable-next-line jsx-a11y/no-autofocus -- the user just asked to edit this
                autoFocus
                onChange={(event) => setDraft(event.target.value)}
                onBlur={submitRename}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setDraft(board.title);
                    setEditing(false);
                  }
                }}
              />
            </form>
          ) : (
            <Link href={`/${board.id}`} className="truncate font-semibold hover:underline">
              {board.title}
            </Link>
          )}
          <button
            type="button"
            aria-label={board.starred ? 'Unstar' : 'Star'}
            aria-pressed={board.starred}
            className={`rounded p-1 ${board.starred ? 'text-amber-500' : 'text-zinc-400 hover:text-zinc-700'}`}
            onClick={() => onStar(board)}
          >
            <Star className="size-4" fill={board.starred ? 'currentColor' : 'none'} />
          </button>
        </div>
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>
            {board.role} · {relativeTime(board.lastActivityAt)}
          </span>
          <span className="flex items-center gap-1">
            {owner && (
              <button
                type="button"
                aria-label="Rename"
                className="rounded p-1 hover:bg-zinc-100"
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-4" />
              </button>
            )}
            <button
              type="button"
              aria-label="Duplicate"
              className="rounded p-1 hover:bg-zinc-100"
              onClick={() => onDuplicate(board)}
            >
              <Copy className="size-4" />
            </button>
            {owner &&
              (confirming ? (
                <button
                  type="button"
                  className="rounded bg-red-600 px-2 py-0.5 text-white"
                  onBlur={() => setConfirming(false)}
                  onClick={() => onDelete(board)}
                >
                  Confirm delete
                </button>
              ) : (
                <button
                  type="button"
                  aria-label="Delete"
                  className="rounded p-1 hover:bg-red-50 hover:text-red-600"
                  onClick={() => setConfirming(true)}
                >
                  <Trash2 className="size-4" />
                </button>
              ))}
          </span>
        </div>
      </div>
    </li>
  );
};

/**
 * `/boards`: every board this person owns or was invited to, with the
 * actions the roles allow, and new boards from templates. Client-rendered
 * against the Express API, so the page works the same way in every
 * storage mode; without a database the API is absent and the page says so.
 */
const Dashboard = () => {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('loading');
  const [boards, setBoards] = useState<BoardCard[]>([]);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);


  const load = useCallback(async () => {
    try {
      let response = await fetch('/api/boards');

      if (response.status === 401) {
        await ensureGuestCookie();
        response = await fetch('/api/boards');
      }

      if (response.status === 404) {
        setStatus('unavailable');
        return;
      }

      if (!response.ok) {
        setStatus('error');
        return;
      }

      const body = (await response.json()) as { boards: BoardCard[]; identity: Identity };

      setBoards(body.boards);
      setIdentity(body.identity);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    load();
    fetch('/api/templates')
      .then((response) => (response.ok ? response.json() : []))
      .then((list: TemplateSummary[]) => setTemplates(list))
      .catch(() => {});
  }, [load]);

  const create = async (templateId: string) => {
    const response = await fetch('/api/boards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ templateId }),
    });

    if (!response.ok) {
      toast.error('Could not create the board.');
      return;
    }

    const { id } = (await response.json()) as { id: string };
    router.push(`/${id}`);
  };

  const star = async (board: BoardCard) => {
    setBoards((prev) => prev.map((b) => (b.id === board.id ? { ...b, starred: !b.starred } : b)));
    await fetch(`/api/boards/${board.id}/star`, { method: board.starred ? 'DELETE' : 'POST' });
  };

  const rename = async (board: BoardCard, title: string) => {
    const response = await fetch(`/api/boards/${board.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    });

    if (response.ok) {
      setBoards((prev) => prev.map((b) => (b.id === board.id ? { ...b, title } : b)));
    } else {
      toast.error('Could not rename the board.');
    }
  };

  const duplicate = async (board: BoardCard) => {
    const response = await fetch(`/api/boards/${board.id}/duplicate`, { method: 'POST' });

    if (response.ok) {
      toast.success('Board duplicated.');
      await load();
    } else {
      toast.error('Could not duplicate the board.');
    }
  };

  const remove = async (board: BoardCard) => {
    const response = await fetch(`/api/boards/${board.id}`, { method: 'DELETE' });

    if (response.ok) {
      setBoards((prev) => prev.filter((b) => b.id !== board.id));
      toast('Board deleted.');
    } else {
      toast.error('Could not delete the board.');
    }
  };

  const starred = boards.filter((board) => board.starred);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/" className="text-sm text-zinc-500 hover:underline">
            ← Collab
          </Link>
          <h1 className="text-3xl font-extrabold">My boards</h1>
        </div>
        {identity && !identity.isGuest ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="font-semibold">{identity.name ?? identity.email}</span>
            {identity.username && <span className="text-zinc-500">@{identity.username}</span>}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- an Express route, not a page */}
            <a href="/api/auth/signout" className="underline">
              Sign out
            </a>
          </div>
        ) : (
          identity && (
            <p className="text-sm text-zinc-500">
              You are a guest. Sign in on a board to keep these across devices.
            </p>
          )
        )}
      </header>

      {status === 'unavailable' && (
        <p role="alert" className="rounded-lg bg-amber-100 p-4 text-amber-900">
          This server keeps boards in memory only, so there is nothing to list here. Start it with
          <code className="mx-1">STORAGE=pglite</code> or a <code className="mx-1">DATABASE_URL</code> to
          keep boards.
        </p>
      )}

      {status === 'error' && (
        <p role="alert" className="rounded-lg bg-red-100 p-4 text-red-900">
          Could not load your boards.
        </p>
      )}

      {status === 'ready' && (
        <>
          <section aria-labelledby="new-board">
            <h2 id="new-board" className="mb-3 text-lg font-bold">
              New board
            </h2>

            <ul className="flex flex-wrap gap-3">
              {templates.map((template) => (
                <li key={template.id}>
                  <button
                    type="button"
                    className="flex h-full w-44 flex-col items-start gap-1 rounded-xl border border-dashed border-zinc-300 p-3 text-left hover:border-zinc-900"
                    onClick={() => create(template.id)}
                  >
                    <span className="flex items-center gap-1 font-semibold">
                      <Plus className="size-4" /> {template.name}
                    </span>
                    <span className="text-xs text-zinc-500">{template.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {starred.length > 0 && (
            <section aria-labelledby="starred">
              <h2 id="starred" className="mb-3 text-lg font-bold">
                Starred
              </h2>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {starred.map((board) => (
                  <Card
                    key={board.id}
                    board={board}
                    onStar={star}
                    onRename={rename}
                    onDuplicate={duplicate}
                    onDelete={remove}
                  />
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="recent">
            <h2 id="recent" className="mb-3 text-lg font-bold">
              Recent
            </h2>
            {boards.length === 0 ? (
              <p className="text-zinc-500">No boards yet. Create one above.</p>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {boards.map((board) => (
                  <Card
                    key={board.id}
                    board={board}
                    onStar={star}
                    onRename={rename}
                    onDuplicate={duplicate}
                    onDelete={remove}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export default Dashboard;
