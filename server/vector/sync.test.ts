import { randomUUID } from 'crypto';
import type { AddressInfo } from 'net';
import { eq } from 'drizzle-orm';
import { io as connectClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

import { PROTOCOL_VERSION } from '@/common/constants/protocol';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@/common/types/global';
import { createObject, getObject, readAll } from '@/common/vector/doc';
import type { StickyObject } from '@/common/vector/types';

import { createAppServer } from '../app';
import { DbPersistence } from '../boards/dbPersistence';
import { loadConfig } from '../config';
import { createPglite, type Database } from '../db/client';
import { boardDocUpdates, boards } from '../db/schema';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const config = { ...loadConfig({ DEFAULT_ENGINE: 'raster' }), USER_GRACE_MS: 60_000 };

const sticky = (id: string, text: string, createdBy: string): StickyObject => ({
  id,
  type: 'sticky',
  x: 10,
  y: 10,
  w: 200,
  h: 200,
  rotation: 0,
  z: 'a0',
  createdBy,
  createdAt: 1,
  text,
  fill: '#FEF08A',
  fontSize: 18,
});

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** A y-websocket provider from Node, carrying a cookie the way a browser would. */
const openProvider = (origin: string, boardId: string, cookie: string) => {
  const doc = new Y.Doc();

  class CookieSocket extends WebSocket {
    constructor(url: string | URL) {
      super(url, { headers: { cookie } });
    }
  }

  const provider = new WebsocketProvider(`${origin.replace('http', 'ws')}/yjs`, boardId, doc, {
    WebSocketPolyfill: CookieSocket as unknown as typeof globalThis.WebSocket,
    disableBc: true,
  });

  const synced = new Promise<void>((resolve) => {
    provider.on('sync', (isSynced: boolean) => {
      if (isSynced) resolve();
    });
  });

  return { doc, provider, synced };
};

const untilTrue = async (check: () => boolean, ms = 4000) => {
  const started = Date.now();

  while (!check() && Date.now() - started < ms) {
    // eslint-disable-next-line no-await-in-loop -- polling
    await wait(20);
  }

  expect(check()).toBe(true);
};

describe('vector document sync', () => {
  let database: Database;
  let server: ReturnType<typeof createAppServer>;
  let origin: string;
  let boardId: string;
  let ownerId: string;
  let ownerCookie: string;
  let ownerSocket: ClientSocket;

  const guestCookie = async (userId = randomUUID()) => {
    const response = await fetch(`${origin}/api/me/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId }),
    });

    return { userId, cookie: response.headers.getSetCookie().map((line) => line.split(';')[0]).join('; ') };
  };

  const boot = async () => {
    const instance = createAppServer({
      nextHandler: (_req, res) => {
        res.end('next');
      },
      config,
      persistence: new DbPersistence(database, { flushMs: 5 }),
      database,
    });

    await new Promise<void>((resolve) => {
      instance.server.listen(0, () => resolve());
    });

    return instance;
  };

  const halt = async (instance: ReturnType<typeof createAppServer>) => {
    instance.rooms.stop();
    await instance.vectorDocs.stop();
    await instance.boards.flush();
    await new Promise<void>((resolve) => {
      instance.io.close(() => resolve());
    });
  };

  beforeAll(async () => {
    database = await createPglite();
    server = await boot();
    origin = `http://localhost:${(server.server.address() as AddressInfo).port}`;

    ({ userId: ownerId, cookie: ownerCookie } = await guestCookie());
    ownerSocket = connectClient(origin, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: { userId: ownerId, protocolVersion: PROTOCOL_VERSION },
    });
    await new Promise<void>((resolve, reject) => {
      ownerSocket.once('connect', resolve);
      ownerSocket.once('connect_error', reject);
    });

    const created = new Promise<string>((resolve) => {
      ownerSocket.once('created', resolve);
    });
    ownerSocket.emit('create_room', 'Owner', { engine: 'vector', title: 'Objects' });
    boardId = await created;
    await server.boards.flush();
  }, 60_000);

  afterAll(async () => {
    ownerSocket.disconnect();
    await halt(server);
    await database.close();
  });

  it('records the engine with the board and in the snapshot', async () => {
    expect(server.boards.get(boardId)?.engine).toBe('vector');
    expect((await database.db.select().from(boards).where(eq(boards.id, boardId)))[0].engine).toBe('vector');

    const snapshot = new Promise<{ engine?: string }>((resolve) => {
      ownerSocket.once('room', (room) => resolve(room as unknown as { engine?: string }));
    });
    ownerSocket.emit('joined_room');
    expect((await snapshot).engine).toBe('vector');
  });

  it('syncs objects between two editors through the server', async () => {
    const alice = openProvider(origin, boardId, ownerCookie);
    const bobIdentity = await guestCookie();
    const bob = openProvider(origin, boardId, bobIdentity.cookie);

    await Promise.all([alice.synced, bob.synced]);

    createObject(alice.doc, sticky('s1', 'from alice', ownerId), { userId: ownerId });

    await untilTrue(() => getObject(bob.doc, 's1') !== null);
    expect((getObject(bob.doc, 's1') as StickyObject).text).toBe('from alice');

    // Concurrent edits to one sticky converge.
    const aliceText = alice.doc.getMap<Y.Map<unknown>>('objects').get('s1')?.get('text') as Y.Text;
    const bobText = bob.doc.getMap<Y.Map<unknown>>('objects').get('s1')?.get('text') as Y.Text;
    aliceText.insert(aliceText.length, ' +a');
    bobText.insert(0, 'b+ ');

    await untilTrue(
      () =>
        (getObject(alice.doc, 's1') as StickyObject).text === (getObject(bob.doc, 's1') as StickyObject).text &&
        (getObject(alice.doc, 's1') as StickyObject).text.includes('+a') &&
        (getObject(alice.doc, 's1') as StickyObject).text.includes('b+'),
    );

    alice.provider.destroy();
    bob.provider.destroy();
  });

  it('gives viewers a read-only connection whose updates are dropped', async () => {
    await database.db.update(boards).set({ linkRole: 'viewer' }).where(eq(boards.id, boardId));
    server.roles.invalidate(boardId);

    const viewerIdentity = await guestCookie();
    const viewer = openProvider(origin, boardId, viewerIdentity.cookie);
    const owner = openProvider(origin, boardId, ownerCookie);

    await Promise.all([viewer.synced, owner.synced]);

    // The viewer sees the board...
    expect(getObject(viewer.doc, 's1')).not.toBeNull();

    // ...but its own change never reaches the server or the owner.
    createObject(viewer.doc, sticky('viewer-object', 'sneaky', viewerIdentity.userId), { userId: viewerIdentity.userId });
    await wait(300);

    expect(getObject(owner.doc, 'viewer-object')).toBeNull();
    expect(getObject(server.vectorDocs.get(boardId)?.doc as Y.Doc, 'viewer-object')).toBeNull();

    viewer.provider.destroy();
    owner.provider.destroy();

    await database.db.update(boards).set({ linkRole: 'editor' }).where(eq(boards.id, boardId));
    server.roles.invalidate(boardId);
  });

  it('refuses a connection without an identity, and for a raster board', async () => {
    const closes = (cookie: string | undefined, id: string) =>
      new Promise<number>((resolve) => {
        const ws = new WebSocket(`${origin.replace('http', 'ws')}/yjs/${id}`, {
          headers: cookie ? { cookie } : {},
        });
        ws.on('close', (code) => resolve(code));
        ws.on('error', () => {});
      });

    expect(await closes(undefined, boardId)).toBe(4401);

    const rasterCreated = new Promise<string>((resolve) => {
      ownerSocket.once('created', resolve);
    });
    ownerSocket.emit('leave_room');
    ownerSocket.emit('create_room', 'Owner');
    const rasterId = await rasterCreated;

    expect(await closes(ownerCookie, rasterId)).toBe(4404);
  });

  it('persists the document and its update log, and reloads it on a fresh server', async () => {
    await server.vectorDocs.flush();

    const updates = await database.db.select().from(boardDocUpdates).where(eq(boardDocUpdates.boardId, boardId));
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.map((row) => Number(row.seq)).sort((a, b) => a - b)[0]).toBe(1);
    expect(updates.some((row) => row.userId === ownerId)).toBe(true);

    const second = await boot();

    try {
      const entry = await second.vectorDocs.open(boardId);

      expect(readAll(entry.doc).map((object) => object.id)).toEqual(['s1']);
      expect(entry.seq).toBe(updates.length);
    } finally {
      await halt(second);
    }
  });
});
