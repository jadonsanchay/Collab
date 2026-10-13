import type { ReactNode } from 'react';

import Link from 'next/link';

/** The centred card both sign-in pages share. */
const AuthShell = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
    <Link href="/" className="text-3xl font-extrabold">
      Collab
    </Link>
    <section aria-labelledby="auth-title" className="w-full max-w-sm rounded-2xl border border-zinc-200 p-6 shadow-sm">
      <h1 id="auth-title" className="mb-4 text-xl font-bold">
        {title}
      </h1>
      {children}
    </section>
  </div>
);

export default AuthShell;
