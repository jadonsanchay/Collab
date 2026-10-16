import { type FormEvent, useCallback, useEffect, useState } from 'react';

import { Dices } from 'lucide-react';
import Link from 'next/link';

import { MIN_PASSWORD_LENGTH, registerSchema } from '@/common/schemas/auth';

import { fetchCsrfToken, submitPasswordSignIn } from '../lib/csrf';
import AuthShell from './AuthShell';

type Field = 'name' | 'username' | 'email' | 'password';

const FIELDS: { field: Field; label: string; type: string; autoComplete: string; hint?: string }[] = [
  { field: 'name', label: 'Name', type: 'text', autoComplete: 'name', hint: 'Shown on boards' },
  { field: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
  { field: 'password', label: 'Password', type: 'password', autoComplete: 'new-password', hint: `At least ${MIN_PASSWORD_LENGTH} characters` },
];

const SignupForm = () => {
  const [values, setValues] = useState<Record<Field, string>>({ name: '', username: '', email: '', password: '' });
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [rolling, setRolling] = useState(false);

  const parsed = registerSchema.safeParse(values);

  // The handle is dealt, not typed: it is permanent, so it should be
  // something nobody has to spell, and it stays unique by construction.
  const rollUsername = useCallback(async () => {
    setRolling(true);

    try {
      const response = await fetch('/api/account/username');
      const body = (await response.json()) as { username?: string };

      if (body.username) setValues((prev) => ({ ...prev, username: body.username as string }));
    } catch {
      setError({ message: 'Could not fetch a username. Try again.' });
    } finally {
      setRolling(false);
    }
  }, []);

  useEffect(() => {
    rollUsername();
  }, [rollUsername]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!parsed.success) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/account/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string; field?: string };
        setError({ field: body.field, message: body.error ?? 'Could not create the account.' });
        setBusy(false);
        return;
      }

      // Registered: sign in straight away with the same credentials.
      submitPasswordSignIn(await fetchCsrfToken(), parsed.data.email, parsed.data.password);
    } catch {
      setError({ message: 'Could not reach the server.' });
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Create an account">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <div className="flex flex-col gap-1 text-sm font-semibold">
          <span id="signup-username-label">Username</span>
          <div className="flex items-center gap-2">
            <output
              id="signup-username"
              aria-labelledby="signup-username-label"
              className="input w-full text-sm"
              data-testid="generated-username"
            >
              {values.username || '…'}
            </output>
            <button
              type="button"
              className="btn-icon shrink-0 bg-zinc-100"
              aria-label="Generate another username"
              disabled={rolling}
              onClick={rollUsername}
            >
              <Dices className="size-5" />
            </button>
          </div>
          <span className="text-xs font-normal text-zinc-500">
            Yours for good once the account exists. Roll until you like one.
          </span>
        </div>

        {FIELDS.map(({ field, label, type, autoComplete, hint }) => (
          <label key={field} htmlFor={`signup-${field}`} className="flex flex-col gap-1 text-sm font-semibold">
            {label}
            <input
              id={`signup-${field}`}
              type={type}
              className="input w-full"
              autoComplete={autoComplete}
              value={values[field]}
              onChange={(event) => setValues((prev) => ({ ...prev, [field]: event.target.value }))}
              aria-invalid={error?.field === field || undefined}
              required
            />
            {hint && <span className="text-xs font-normal text-zinc-500">{hint}</span>}
          </label>
        ))}

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error.message}
          </p>
        )}

        <button type="submit" className="btn mt-2 disabled:opacity-40" disabled={!parsed.success || busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>

      <p className="mt-4 text-sm text-zinc-600">
        Already have one?{' '}
        <Link href="/login" className="font-semibold underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
};

export default SignupForm;
