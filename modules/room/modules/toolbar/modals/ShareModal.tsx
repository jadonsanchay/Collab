import { useCallback, useEffect, useState } from 'react';

import { Link2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import { canManage, type GrantableRole } from '@/common/constants/roles';
import { useFeatureFlag } from '@/common/hooks/useFeatureFlag';
import { useMyRole, useRoom } from '@/common/store/room.store';
import { useModal } from '@/modules/modal';

type ShareLink = {
  token: string;
  role: GrantableRole;
  expiresAt: number | null;
  createdAt: number;
};

const ROLE_LABELS: Record<GrantableRole, string> = {
  editor: 'can edit',
  commenter: 'can comment',
  viewer: 'can view',
};

/**
 * Invitations by link. Owners of a persisted board mint links that grant a
 * role; everyone else copies the board's URL, which is what a `link`
 * visibility board accepts on its own.
 */
const ShareLinks = ({ boardId }: { boardId: string }) => {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [role, setRole] = useState<GrantableRole>('editor');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/boards/${boardId}/share-links`);

    if (response.ok) setLinks((await response.json()) as ShareLink[]);
  }, [boardId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const create = async () => {
    setBusy(true);

    try {
      const response = await fetch(`/api/boards/${boardId}/share-links`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role }),
      });

      if (!response.ok) {
        toast.error('Could not create the link.');
        return;
      }

      const link = (await response.json()) as ShareLink & { url: string };
      const url = new URL(link.url, window.location.origin).toString();

      await navigator.clipboard.writeText(url).catch(() => {});
      toast.success(`Invitation link copied (${ROLE_LABELS[link.role]}).`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (token: string) => {
    const response = await fetch(`/api/boards/${boardId}/share-links/${token}`, { method: 'DELETE' });

    if (response.ok) {
      toast('Link revoked.');
      await load();
    }
  };

  return (
    <div className="mt-6 flex w-full flex-col gap-2 text-left">
      <h4 className="font-bold">Invite by link</h4>
      <div className="flex items-center gap-2">
        <select
          aria-label="Invitation role"
          className="rounded-lg border p-2 text-sm"
          value={role}
          onChange={(event) => setRole(event.target.value as GrantableRole)}
        >
          <option value="editor">Can edit</option>
          <option value="commenter">Can comment</option>
          <option value="viewer">Can view</option>
        </select>
        <button type="button" className="btn text-sm" disabled={busy} onClick={create}>
          Create link
        </button>
      </div>
      {links.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {links.map((link) => (
            <li key={link.token} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2 truncate">
                <Link2 className="size-4 shrink-0" />
                <button
                  type="button"
                  className="truncate underline"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(new URL(`/join/${link.token}`, window.location.origin).toString())
                      .then(() => toast('Copied.'))
                  }
                >
                  …/join/{link.token.slice(0, 8)}
                </button>
                <span className="text-zinc-500">{ROLE_LABELS[link.role]}</span>
              </span>
              <button
                type="button"
                aria-label="Revoke link"
                className="rounded p-1 hover:bg-zinc-100"
                onClick={() => revoke(link.token)}
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const ShareModal = () => {
  const { id } = useRoom();
  const { closeModal } = useModal();
  const persistent = useFeatureFlag('persistent');
  const owner = canManage(useMyRole());

  const [url, setUrl] = useState('');

  useEffect(() => setUrl(window.location.href), []);

  const handleCopy = () => navigator.clipboard.writeText(url);

  return (
    <div className="relative flex flex-col items-center rounded-md bg-white p-10 pt-5">
      <button
        type="button"
        onClick={closeModal}
        className="absolute right-5 top-5"
      >
        <X />
      </button>
      <h2 className="text-2xl font-bold">Invite</h2>
      <h3>
        Room id: <p className="inline font-bold">{id}</p>
      </h3>
      <div className="relative mt-2">
        <input type="text" value={url} readOnly className="input sm:w-96" />
        <button
          type="button"
          className="btn absolute right-0 h-full"
          onClick={handleCopy}
        >
          Copy
        </button>
      </div>
      {persistent && owner && <ShareLinks boardId={id} />}
    </div>
  );
};

export default ShareModal;
