import { useEffect, useState } from 'react';

import type { NextPage } from 'next';
import { useRouter } from 'next/router';

type Outcome =
  | { status: 'redeeming' }
  | { status: 'ok'; boardId: string; role: string }
  | { status: 'invalid' | 'expired' | 'revoked' | 'error' | 'unauthorized' };

const MESSAGES: Record<Exclude<Outcome['status'], 'ok' | 'redeeming'>, string> = {
  invalid: 'This invitation link is not valid.',
  expired: 'This invitation link has expired.',
  revoked: 'This invitation link was revoked by the board owner.',
  unauthorized: 'Open Collab once first, then try the link again.',
  error: 'Something went wrong redeeming the link.',
};

/**
 * `/join/<token>`: redeems a share link into a membership and sends the
 * visitor to the board. Identity comes from the guest cookie or the
 * session, which the app set the first time it was opened.
 */
const JoinPage: NextPage = () => {
  const router = useRouter();
  const token = typeof router.query.token === 'string' ? router.query.token : '';
  const [outcome, setOutcome] = useState<Outcome>({ status: 'redeeming' });

  useEffect(() => {
    if (!token) return;

    const redeem = async () => {
      try {
        const response = await fetch(`/api/join/${encodeURIComponent(token)}`, { method: 'POST' });

        if (response.status === 401) {
          setOutcome({ status: 'unauthorized' });
          return;
        }

        const body = (await response.json()) as Outcome;

        if (body.status === 'ok') {
          setOutcome(body);
          router.replace(`/${body.boardId}`);
          return;
        }

        setOutcome(body.status in MESSAGES ? body : { status: 'error' });
      } catch {
        setOutcome({ status: 'error' });
      }
    };

    redeem();
  }, [token, router]);

  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <h1 className="text-3xl font-extrabold">Collab</h1>
      {outcome.status === 'redeeming' && <p>Opening the board…</p>}
      {outcome.status === 'ok' && <p>You are in as {outcome.role}. Taking you to the board…</p>}
      {outcome.status !== 'redeeming' && outcome.status !== 'ok' && (
        <>
          <p role="alert">{MESSAGES[outcome.status]}</p>
          <button type="button" className="btn" onClick={() => router.push('/')}>
            Go home
          </button>
        </>
      )}
    </div>
  );
};

export default JoinPage;
