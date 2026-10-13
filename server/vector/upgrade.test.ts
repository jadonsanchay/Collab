import { randomUUID } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import path from 'path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { DrawPayload } from '@/common/types/global';
import { readAll } from '@/common/vector/doc';

import { createAppServer } from '../app';
import { DbPersistence } from '../boards/dbPersistence';
import { loadConfig } from '../config';
import { createPglite, type Database } from '../db/client';
import { boards } from '../db/schema';
import { LocalStorage } from '../storage/local';

const BLACK = { r: 0, g: 0, b: 0, a: 1 };
const CLEAR = { r: 0, g: 0, b: 0, a: 0 };

type Overrides = Omit<Partial<DrawPayload>, 'options'> & { options?: Partial<DrawPayload['options']> };

const payload = (overrides: Overrides): DrawPayload => ({
  circle: { cX: 0, cY: 0, radiusX: 0, radiusY: 0 },
  rect: { width: 0, height: 0 },
  img: {},
  path: [[10, 10]],
  clientId: randomUUID(),
  ...overrides,
  options: {
    lineWidth: 4,
    lineColor: BLACK,
    fillColor: CLEAR,
    shape: 'line',
    mode: 'draw',
    selection: null,
    ...overrides.options,
  },
});

describe('upgrading a raster board to objects', () => {
  let dir: string;
  let database: Database;
  let server: ReturnType<typeof createAppServer>;
  let origin: string;
  let owner: { userId: string; cookie: string };
  let stranger: { userId: string; cookie: string };

  const guestCookie = async (userId = randomUUID()) => {
    const response = await fetch(`${origin}/api/me/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId }),
    });

    return { userId, cookie: response.headers.getSetCookie().map((line) => line.split(';')[0]).join('; ') };
  };

  const api = (pathname: string, init: RequestInit = {}, cookie = owner.cookie) =>
    fetch(`${origin}${pathname}`, {
      ...init,
      headers: { 'content-type': 'application/json', cookie, ...(init.headers ?? {}) },
    });

  const createBoard = async () => {
    const response = await api('/api/boards', { method: 'POST', body: JSON.stringify({ templateId: 'blank' }) });

    return ((await response.json()) as { id: string }).id;
  };

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'collab-upgrade-'));
    database = await createPglite();
    server = createAppServer({
      nextHandler: (_req, res) => {
        res.end('next');
      },
      config: { ...loadConfig({ DEFAULT_ENGINE: 'raster' }), UPLOADS_DIR: dir, USER_GRACE_MS: 60_000 },
      persistence: new DbPersistence(database, { flushMs: 5 }),
      database,
      storage: new LocalStorage({ dir, secret: 's' }),
    });

    await new Promise<void>((resolve) => {
      server.server.listen(0, () => resolve());
    });
    origin = `http://localhost:${(server.server.address() as AddressInfo).port}`;
    owner = await guestCookie();
    stranger = await guestCookie();
  }, 60_000);

  afterAll(async () => {
    server.rooms.stop();
    await server.vectorDocs.stop();
    await server.boards.flush();
    await new Promise<void>((resolve) => {
      server.io.close(() => resolve());
    });
    await database.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('converts moves to objects, flips the engine everywhere, and refuses to do it twice', async () => {
    const boardId = await createBoard();

    server.boards.addMove(boardId, owner.userId, payload({ path: [[100, 100], [160, 140], [220, 180]] }));
    server.boards.addMove(
      boardId,
      owner.userId,
      payload({ options: { shape: 'text' }, path: [[300, 100]], text: { content: 'hello', fontSize: 24 } }),
    );

    // Editors can use the board, but only the owner may convert it.
    expect((await api(`/api/boards/${boardId}/upgrade`, { method: 'POST' }, stranger.cookie)).status).toBe(403);

    const response = await api(`/api/boards/${boardId}/upgrade`, { method: 'POST' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ engine: 'vector', strategy: 'objects', objects: 2 });
    expect(server.boards.get(boardId)?.engine).toBe('vector');

    await server.boards.flush();
    expect((await database.db.select().from(boards).where(eq(boards.id, boardId)))[0].engine).toBe('vector');

    const doc = server.vectorDocs.get(boardId)?.doc;
    expect(doc).toBeDefined();

    const objects = readAll(doc as Y.Doc);
    expect(objects.map((object) => object.type)).toEqual(['stroke', 'text']);
    objects.forEach((object) => expect(object.meta).toEqual({ legacy: true }));

    expect((await api(`/api/boards/${boardId}/upgrade`, { method: 'POST' })).status).toBe(409);

    // The update log rebuilds the same document: Rewind's whole premise.
    const log = (await (await api(`/api/boards/${boardId}/doc-updates`)).json()) as {
      latestSeq: number;
      updates: { seq: number; userId: string | null; update: string }[];
    };

    expect(log.latestSeq).toBeGreaterThanOrEqual(1);
    expect(log.updates.map((entry) => entry.seq)).toEqual(log.updates.map((_, i) => i + 1));
    expect(log.updates[0].userId).toBe(owner.userId);

    const rebuilt = new Y.Doc();
    log.updates.forEach((entry) => Y.applyUpdate(rebuilt, new Uint8Array(Buffer.from(entry.update, 'base64'))));

    expect(readAll(rebuilt)).toEqual(objects);
  });

  it('flattens an erased board to a locked picture and keeps later text editable', async () => {
    const boardId = await createBoard();

    server.boards.addMove(boardId, owner.userId, payload({ path: [[100, 100], [400, 400]] }));
    server.boards.addMove(boardId, owner.userId, payload({ options: { mode: 'eraser' }, path: [[200, 200], [300, 300]] }));
    server.boards.addMove(
      boardId,
      owner.userId,
      payload({ options: { shape: 'text' }, path: [[500, 100]], text: { content: 'after', fontSize: 24 } }),
    );

    const response = await api(`/api/boards/${boardId}/upgrade`, { method: 'POST' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ engine: 'vector', strategy: 'image', objects: 2 });

    const objects = readAll(server.vectorDocs.get(boardId)?.doc as Y.Doc);

    expect(objects[0]).toMatchObject({ type: 'image', locked: true, x: 0, y: 0, w: 4000, h: 2000, meta: { legacy: true } });
    expect((objects[0] as { url: string }).url).toContain(`boards/${boardId}/legacy/`);
    expect(objects[1]).toMatchObject({ type: 'text', text: 'after' });
  }, 30_000);

  it('answers 404 for the update log of a drawing board', async () => {
    const boardId = await createBoard();

    expect((await api(`/api/boards/${boardId}/doc-updates`)).status).toBe(404);
  });
});
