import { LogIn } from 'lucide-react';

import { useFeatureFlag } from '@/common/hooks/useFeatureFlag';
import { useIdentity } from '@/common/store/session.store';

/**
 * Sign in, or who is signed in with a way out. Renders nothing on a server
 * without sign-in, so a deployment with no OAuth keys shows no trace of it.
 * Shared by the landing page header and the room's top bar.
 */
const AccountButton = () => {
  const auth = useFeatureFlag('auth');
  const identity = useIdentity();

  if (!auth) return null;

  if (!identity || identity.isGuest) {
    return (
      // eslint-disable-next-line @next/next/no-html-link-for-pages -- an Express route, not a page
      <a
        href="/login"
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

export default AccountButton;
