import { randomUUID } from 'crypto';
import type { AddressInfo } from 'net';
import { encode } from '@auth/core/jwt';
import { eq } from 'drizzle-orm';
import { io as connectClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PROTOCOL_VERSION } from '@/common/constants/protocol';
import type {
  ClientToServerEvents,
  Identity,
  ServerToClientEvents,
} from '@/common/types/global';

import { createAppServer } from '../app';
import { DbPersistence } from '../boards/dbPersistence';
import { loadConfig } from '../config';
import { createPglite, type Database } from '../db/client';
import { boards, users } from '../db/schema';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const SECRET = 'test-secret-that-is-long-enough';

const config = {
  ...loadConfig({}),
  AUTH_SECRET: SECRET,
  AUTH_DEV_LOGIN: true,
  USER_GRACE_MS: 200,
  ROOM_GRACE_MS: 500,
  SWEEP_INTERVAL_MS: 50,
};

/** Extracts `name=value` pairs from a response's Set-Cookie headers. */
const cookiesOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((line) => line.split(';')[0])
    .join('; ');

describe('identity: guests, sessions, and the merge between them', () => {
  let database: Database;
  let server: ReturnType<typeof createAppServer>;
  let origin: string;

  const connect = (auth: Record<string, unknown>, cookie?: string) => {
    const socket: ClientSocket = connectClient(origin, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth,
      ...(cookie ? { extraHeaders: { cookie } } : {}),
    });

    const identity = new Promise<Identity>((resolve) => {
      socket.once('identity', resolve);
    });

    const connected = new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });

    return { socket, identity, connected };
  };

  beforeAll(async () => {
    database = await createPglite();
    server = createAppServer({
      nextHandler: (_req, res) => {
        res.end('next');
      },
      config,
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

  it('advertises sign-in and persistence', async () => {
    expect(server.features).toMatchObject({ auth: true, persistent: true });
  });

  it('knows nobody without cookies, then a guest once the browser mirrors its id', async () => {
    expect(await (await fetch(`${origin}/api/me`)).json()).toBeNull();

    const guestId = randomUUID();
    const response = await fetch(`${origin}/api/me/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: guestId }),
    });

    expect(response.status).toBe(200);
    const cookie = cookiesOf(response);
    expect(cookie).toMatch(/^collab_guest=/);

    const me = await (await fetch(`${origin}/api/me`, { headers: { cookie } })).json();
    expect(me).toMatchObject({ userId: guestId, isGuest: true });

    const [row] = await database.db.select().from(users).where(eq(users.id, guestId));
    expect(row?.isGuest).toBe(true);

    expect(
      (
        await fetch(`${origin}/api/me/guest`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userId: 'nope' }),
        })
      ).status,
    ).toBe(400);
  });

  it('signs in through the dev provider and reports the account', async () => {
    const csrfResponse = await fetch(`${origin}/api/auth/csrf`);
    const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };
    let cookie = cookiesOf(csrfResponse);

    const body = new URLSearchParams({
      csrfToken,
      email: 'Alice@Example.com',
      name: 'Alice',
    });

    const callback = await fetch(`${origin}/api/auth/callback/dev`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body,
      redirect: 'manual',
    });

    expect([200, 302]).toContain(callback.status);
    cookie = [cookie, cookiesOf(callback)].filter(Boolean).join('; ');
    expect(cookie).toMatch(/authjs\.session-token=/);

    const me = (await (await fetch(`${origin}/api/me`, { headers: { cookie } })).json()) as Identity;

    expect(me).toMatchObject({ isGuest: false, email: 'alice@example.com', name: 'Alice' });

    const [row] = await database.db.select().from(users).where(eq(users.id, me.userId));
    expect(row).toMatchObject({ email: 'alice@example.com', isGuest: false });
  });

  it('resolves a socket to the account from the session cookie and merges the guest it came from', async () => {
    // A guest with a board...
    const guestId = randomUUID();
    const guest = connect({ userId: guestId, protocolVersion: PROTOCOL_VERSION });
    await guest.connected;
    expect((await guest.identity).isGuest).toBe(true);

    const created = new Promise<string>((resolve) => {
      guest.socket.once('created', resolve);
    });
    guest.socket.emit('create_room', 'Guesty');
    const roomId = await created;
    await server.boards.flush();
    guest.socket.disconnect();

    // ...signs in. The next handshake carries the session and the old id.
    const accountId = randomUUID();
    await database.db.insert(users).values({
      id: accountId,
      email: 'bob@example.com',
      name: 'Bob',
      isGuest: false,
    });

    const jwt = await encode({
      token: { sub: accountId, name: 'Bob', email: 'bob@example.com' },
      secret: SECRET,
      salt: 'authjs.session-token',
    });

    const account = connect(
      { userId: guestId, protocolVersion: PROTOCOL_VERSION },
      `authjs.session-token=${jwt}`,
    );
    await account.connected;

    expect(await account.identity).toMatchObject({
      userId: accountId,
      isGuest: false,
      name: 'Bob',
      email: 'bob@example.com',
    });

    const [board] = await database.db.select().from(boards).where(eq(boards.id, roomId));
    expect(board.ownerId).toBe(accountId);
    expect(server.rooms.get(roomId)?.ownerId).toBe(accountId);
    expect(await database.db.select().from(users).where(eq(users.id, guestId))).toEqual([]);

    account.socket.disconnect();
  });

  it('refuses a guest handshake that presents an account id', async () => {
    const [bob] = await database.db.select().from(users).where(eq(users.email, 'bob@example.com'));

    const impostor = connect({ userId: bob.id, protocolVersion: PROTOCOL_VERSION });

    await expect(impostor.connected).rejects.toThrow('identity_taken');
    impostor.socket.disconnect();
  });

  it('ignores a session cookie that does not verify', async () => {
    const guestId = randomUUID();
    const forged = connect(
      { userId: guestId, protocolVersion: PROTOCOL_VERSION },
      'authjs.session-token=not-a-real-token',
    );
    await forged.connected;

    expect(await forged.identity).toMatchObject({ userId: guestId, isGuest: true });
    forged.socket.disconnect();
  });
});
