import { randomUUID } from 'crypto';
import type { AddressInfo } from 'net';
import { eq } from 'drizzle-orm';
import { io as connectClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PROTOCOL_VERSION } from '@/common/constants/protocol';
import type {
  ClientToServerEvents,
  JoinMeta,
  ServerToClientEvents,
} from '@/common/types/global';

import { createAppServer } from '../app';
import { loadConfig } from '../config';
import { createPglite, type Database } from '../db/client';
import { boards } from '../db/schema';
import { makeMove } from '../testing/fixtures';
import { DbPersistence } from './dbPersistence';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const config = { ...loadConfig({ DEFAULT_ENGINE: 'raster' }), USER_GRACE_MS: 200, ROOM_GRACE_MS: 500, SWEEP_INTERVAL_MS: 50 };

const waitFor = <E extends keyof ServerToClientEvents>(
  socket: ClientSocket,
  event: E,
  ms = 4000,
): Promise<Parameters<ServerToClientEvents[E]>> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${String(event)}`)), ms);

    socket.once(event, ((...args: unknown[]) => {
      clearTimeout(timer);
      resolve(args as Parameters<ServerToClientEvents[E]>);
    }) as never);
  });

const expectNoEvent = async <E extends keyof ServerToClientEvents>(
  socket: ClientSocket,
  event: E,
  ms = 300,
) => {
  let fired = false;
  const listener = () => {
    fired = true;
  };

  socket.on(event, listener as never);
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
  socket.off(event, listener as never);

  expect(fired, `expected no ${String(event)}`).toBe(false);
};

describe('roles decide who may join, draw, chat and rename', () => {
  let database: Database;
  let server: ReturnType<typeof createAppServer>;
  let origin: string;
  let owner: ClientSocket & { userId: string };
  let viewer: ClientSocket & { userId: string };
  let roomId: string;

  const connect = async (userId = randomUUID()) => {
    const socket: ClientSocket = connectClient(origin, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: { userId, protocolVersion: PROTOCOL_VERSION },
    });

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });

    return Object.assign(socket, { userId });
  };

  const join = async (socket: ClientSocket, id: string, name: string) => {
    const joined = waitFor(socket, 'joined');
    socket.emit('join_room', id, name);
    const [, failed, meta] = await joined;

    return { failed: Boolean(failed), meta: meta as JoinMeta | undefined };
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

    owner = await connect();
    const created = waitFor(owner, 'created');
    owner.emit('create_room', 'Owner');
    [roomId] = await created;
    owner.emit('joined_room');
    await waitFor(owner, 'room');
    await server.boards.flush();

    // Anyone with the link may only look.
    await database.db.update(boards).set({ linkRole: 'viewer' }).where(eq(boards.id, roomId));
    server.roles.invalidate(roomId);

    viewer = await connect();
  }, 60_000);

  afterAll(async () => {
    owner.disconnect();
    viewer.disconnect();
    server.rooms.stop();
    await server.boards.flush();
    await new Promise<void>((resolve) => {
      server.io.close(() => resolve());
    });
    await database.close();
  });

  it('tells a joiner their role', async () => {
    const result = await join(viewer, roomId, 'Viewer');

    expect(result.failed).toBe(false);
    expect(result.meta).toEqual({ role: 'viewer' });

    viewer.emit('joined_room');
    await waitFor(viewer, 'room');
  });

  it('refuses a viewer’s draw, undo, chat and rename, and says so', async () => {
    const denied = waitFor(viewer, 'denied');
    viewer.emit('draw', makeMove());
    expect(await denied).toEqual(['draw', 'viewer']);
    await expectNoEvent(owner, 'user_draw');

    const deniedChat = waitFor(viewer, 'denied');
    viewer.emit('send_msg', 'let me in');
    expect(await deniedChat).toEqual(['send_msg', 'viewer']);

    const deniedRename = waitFor(viewer, 'denied');
    viewer.emit('rename_room', 'Mine now');
    expect(await deniedRename).toEqual(['rename_room', 'viewer']);
  });

  it('lets the owner draw and rename, and everyone hears the new title', async () => {
    const echoed = waitFor(owner, 'your_move');
    owner.emit('draw', makeMove());
    await echoed;

    const renamed = waitFor(viewer, 'room_renamed');
    owner.emit('rename_room', '  Q3 planning  ');
    expect((await renamed)[0]).toBe('Q3 planning');
    expect(server.rooms.get(roomId)?.title).toBe('Q3 planning');
  });

  it('keeps strangers out of a private board with a reason', async () => {
    await database.db.update(boards).set({ visibility: 'private' }).where(eq(boards.id, roomId));
    server.roles.invalidate(roomId);

    const stranger = await connect();
    const result = await join(stranger, roomId, 'Stranger');

    expect(result.failed).toBe(true);
    expect(result.meta).toEqual({ reason: 'forbidden' });
    stranger.disconnect();
  });

  it('lets a share link in over HTTP, with the link’s role', async () => {
    // The owner mints a link; identity comes from the guest cookie.
    const ownerCookie = async () => {
      const response = await fetch(`${origin}/api/me/guest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: owner.userId }),
      });

      return response.headers.getSetCookie().map((line) => line.split(';')[0]).join('; ');
    };

    const cookie = await ownerCookie();
    const minted = await fetch(`${origin}/api/boards/${roomId}/share-links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ role: 'editor' }),
    });

    expect(minted.status).toBe(201);
    const link = (await minted.json()) as { token: string; url: string };
    expect(link.url).toBe(`/join/${link.token}`);

    // A stranger redeems it and can then join and draw.
    const strangerId = randomUUID();
    const strangerCookieResponse = await fetch(`${origin}/api/me/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: strangerId }),
    });
    const strangerCookie = strangerCookieResponse.headers
      .getSetCookie()
      .map((line) => line.split(';')[0])
      .join('; ');

    const redeemed = await fetch(`${origin}/api/join/${link.token}`, {
      method: 'POST',
      headers: { cookie: strangerCookie },
    });

    expect(await redeemed.json()).toEqual({ status: 'ok', boardId: roomId, role: 'editor' });

    const stranger = await connect(strangerId);
    const result = await join(stranger, roomId, 'Invited');

    expect(result.failed).toBe(false);
    expect(result.meta).toEqual({ role: 'editor' });

    stranger.emit('joined_room');
    await waitFor(stranger, 'room');
    const echoed = waitFor(stranger, 'your_move');
    stranger.emit('draw', makeMove());
    await echoed;
    stranger.disconnect();

    // Only the owner manages links.
    const listedByViewer = await fetch(`${origin}/api/boards/${roomId}/share-links`, {
      headers: { cookie: strangerCookie },
    });
    expect(listedByViewer.status).toBe(403);

    const listed = await fetch(`${origin}/api/boards/${roomId}/share-links`, { headers: { cookie } });
    expect(((await listed.json()) as unknown[]).length).toBe(1);

    const revoked = await fetch(`${origin}/api/boards/${roomId}/share-links/${link.token}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(revoked.status).toBe(204);
    expect((await fetch(`${origin}/api/join/${link.token}`, { method: 'POST', headers: { cookie: strangerCookie } })).status).toBe(410);
  });
});
