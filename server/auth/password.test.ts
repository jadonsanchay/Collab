import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAppServer } from '../app';
import { DbPersistence } from '../boards/dbPersistence';
import { loadConfig } from '../config';
import { createPglite, type Database } from '../db/client';
import { hashPassword, verifyPassword } from './password';

const SECRET = 'test-secret-that-is-long-enough';

const cookiesOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((line) => line.split(';')[0])
    .join('; ');

describe('password hashing', () => {
  it('verifies the right password and rejects the wrong one, with a self-describing hash', async () => {
    const stored = await hashPassword('correct horse battery staple');

    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
    expect(await verifyPassword('Correct horse battery staple', stored)).toBe(false);
    expect(await verifyPassword('anything', null)).toBe(false);
    expect(await verifyPassword('anything', 'garbage')).toBe(false);
  });

  it('salts: the same password hashes differently twice', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });
});

describe('register and sign in with a password', () => {
  let database: Database;
  let server: ReturnType<typeof createAppServer>;
  let origin: string;

  const register = (body: Record<string, string>) =>
    fetch(`${origin}/api/account/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  /** The browser flow: CSRF token, then the credentials post; returns the session cookie. */
  const signIn = async (identifier: string, password: string) => {
    const csrfResponse = await fetch(`${origin}/api/auth/csrf`);
    const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };
    const cookie = cookiesOf(csrfResponse);

    const callback = await fetch(`${origin}/api/auth/callback/password`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: new URLSearchParams({ csrfToken, identifier, password, callbackUrl: `${origin}/boards` }),
      redirect: 'manual',
    });

    return { status: callback.status, location: callback.headers.get('location') ?? '', cookie: [cookie, cookiesOf(callback)].join('; ') };
  };

  beforeAll(async () => {
    database = await createPglite();
    server = createAppServer({
      nextHandler: (_req, res) => {
        res.end('next');
      },
      config: { ...loadConfig({ DEFAULT_ENGINE: 'raster' }), AUTH_SECRET: SECRET, USER_GRACE_MS: 60_000 },
      persistence: new DbPersistence(database, { flushMs: 5 }),
      database,
    });
    await new Promise<void>((resolve) => {
      server.server.listen(0, () => resolve());
    });
    origin = `http://localhost:${(server.server.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    server.rooms.stop();
    await server.boards.flush();
    await new Promise<void>((resolve) => {
      server.io.close(() => resolve());
    });
    await database.close();
  });

  it('creates an account, signs in by email and by username, and reports the account', async () => {
    const created = await register({ name: 'Alice', username: 'Alice_01', email: 'Alice@Example.com', password: 'hunter2hunter2' });

    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ name: 'Alice', username: 'alice_01', email: 'alice@example.com' });

    const byEmail = await signIn('alice@example.com', 'hunter2hunter2');
    expect(byEmail.status).toBe(302);
    expect(byEmail.location).toBe(`${origin}/boards`);
    expect(byEmail.cookie).toMatch(/authjs\.session-token=/);

    const me = await (await fetch(`${origin}/api/me`, { headers: { cookie: byEmail.cookie } })).json();
    expect(me).toMatchObject({ isGuest: false, name: 'Alice', email: 'alice@example.com' });

    const byUsername = await signIn('ALICE_01', 'hunter2hunter2');
    expect(byUsername.cookie).toMatch(/authjs\.session-token=/);
  });

  it('sends a wrong password back to the login page without a session', async () => {
    const attempt = await signIn('alice@example.com', 'not-the-password');

    expect(attempt.status).toBe(302);
    expect(attempt.location).toContain('/login');
    expect(attempt.location).toContain('error=CredentialsSignin');
    expect(attempt.cookie).not.toMatch(/authjs\.session-token=/);
  });

  it('refuses duplicates and bad input with the field named', async () => {
    const dupeEmail = await register({ name: 'B', username: 'bob', email: 'alice@example.com', password: 'hunter2hunter2' });
    expect(dupeEmail.status).toBe(409);
    expect(await dupeEmail.json()).toMatchObject({ field: 'email' });

    const dupeName = await register({ name: 'B', username: 'alice_01', email: 'bob@example.com', password: 'hunter2hunter2' });
    expect(dupeName.status).toBe(409);
    expect(await dupeName.json()).toMatchObject({ field: 'username' });

    const short = await register({ name: 'B', username: 'bob', email: 'bob@example.com', password: 'short' });
    expect(short.status).toBe(400);
    expect(await short.json()).toMatchObject({ field: 'password' });

    const badHandle = await register({ name: 'B', username: 'Bob Smith!', email: 'bob@example.com', password: 'hunter2hunter2' });
    expect(badHandle.status).toBe(400);
    expect(await badHandle.json()).toMatchObject({ field: 'username' });
  });
});
