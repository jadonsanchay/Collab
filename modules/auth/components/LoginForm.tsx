import { type FormEvent, useEffect, useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/router';

import { fetchCsrfToken, submitPasswordSignIn } from '../lib/csrf';
import AuthShell from './AuthShell';

const ERRORS: Record<string, string> = {
  CredentialsSignin: 'Wrong email, username or password.',
  Default: 'Sign-in failed. Try again.',
};

const LoginForm = () => {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [csrfToken, setCsrfToken] = useState<string | null>(null);

  useEffect(() => {
    fetchCsrfToken().then(setCsrfToken).catch(() => setCsrfToken(null));
  }, []);

  const error = typeof router.query.error === 'string' ? (ERRORS[router.query.error] ?? ERRORS.Default) : null;
  const callbackUrl = typeof router.query.callbackUrl === 'string' ? router.query.callbackUrl : '/boards';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!csrfToken) return;

    submitPasswordSignIn(csrfToken, identifier, password, callbackUrl);
  };

  return (
    <AuthShell title="Sign in">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <label htmlFor="identifier" className="flex flex-col gap-1 text-sm font-semibold">
          Email or username
          <input
            id="identifier"
            className="input w-full"
            autoComplete="username"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            required
          />
        </label>
        <label htmlFor="password" className="flex flex-col gap-1 text-sm font-semibold">
          Password
          <input
            id="password"
            type="password"
            className="input w-full"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <button type="submit" className="btn mt-2 disabled:opacity-40" disabled={!csrfToken || !identifier || !password}>
          Sign in
        </button>
      </form>

      <p className="mt-4 text-sm text-zinc-600">
        New here?{' '}
        <Link href="/signup" className="font-semibold underline">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
};

export default LoginForm;
