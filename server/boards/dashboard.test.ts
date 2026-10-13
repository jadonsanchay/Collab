import { randomUUID } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAppServer } from '../app';
import { loadConfig } from '../config';
import { createPglite, type Database } from '../db/client';
import { LocalStorage } from '../storage/local';
import { DbPersistence } from './dbPersistence';
import type { BoardCard } from './routes';

describe('dashboard API', () => {
  let dir: string;
  let database: Database;
  let server: ReturnType<typeof createAppServer>;
  let origin: string;
  let cookie: string;
  let boardId: string;

  const guestCookie = async (userId = randomUUID()) => {
    const response = await fetch(`${origin}/api/me/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId }),
    });

    return response.headers.getSetCookie().map((line) => line.split(';')[0]).join('; ');
  };

  const api = (pathname: string, init: RequestInit = {}, asCookie = cookie) =>
    fetch(`${origin}${pathname}`, {
      ...init,
      headers: { 'content-type': 'application/json', cookie: asCookie, ...(init.headers ?? {}) },
    });

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'collab-dashboard-'));
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
    cookie = await guestCookie();
  }, 60_000);

  afterAll(async () => {
    server.rooms.stop();
    await server.boards.flush();
    await new Promise<void>((resolve) => {
      server.io.close(() => resolve());
    });
    await database.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('lists templates and creates a board seeded from one', async () => {
    const templates = (await (await fetch(`${origin}/api/templates`)).json()) as { id: string }[];

    expect(templates.map((template) => template.id)).toEqual(
      expect.arrayContaining(['blank', 'retro', 'kanban', 'brainstorm', 'swot']),
    );

    const created = await api('/api/boards', {
      method: 'POST',
      body: JSON.stringify({ templateId: 'retro' }),
    });

    expect(created.status).toBe(201);
    ({ id: boardId } = (await created.json()) as { id: string });
    expect(boardId).toMatch(/^[A-Za-z0-9_-]{8}$/u);

    const room = server.boards.get(boardId);

    expect(room?.title).toBe('Retrospective');
    expect(server.boards.movesSince(boardId, 0).length).toBeGreaterThan(5);
    // The creator holds a place, offline, until they open the board.
    expect(room?.users.size).toBe(1);
    expect(server.boards.isOffline(boardId, [...(room?.users.keys() ?? [])][0])).toBe(true);
  });

  it('refuses to create without an identity or with an unknown template', async () => {
    expect((await api('/api/boards', { method: 'POST', body: '{}' }, '')).status).toBe(401);
    expect(
      (await api('/api/boards', { method: 'POST', body: JSON.stringify({ templateId: 'nope' }) })).status,
    ).toBe(400);
  });

  it('lists the caller’s boards with role, activity and star state', async () => {
    await server.boards.flush();

    const response = await api('/api/boards');
    const { boards } = (await response.json()) as { boards: BoardCard[] };

    expect(boards).toHaveLength(1);
    expect(boards[0]).toMatchObject({ id: boardId, title: 'Retrospective', role: 'owner', starred: false });

    // A stranger sees nothing.
    const other = await guestCookie();
    expect(((await (await api('/api/boards', {}, other)).json()) as { boards: BoardCard[] }).boards).toEqual([]);
  });

  it('renames, stars, duplicates', async () => {
    const renamed = await api(`/api/boards/${boardId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Sprint 12 retro' }),
    });
    expect(renamed.status).toBe(200);
    expect(server.boards.get(boardId)?.title).toBe('Sprint 12 retro');

    expect((await api(`/api/boards/${boardId}/star`, { method: 'POST' })).status).toBe(204);
    await server.boards.flush();

    const copy = (await (await api(`/api/boards/${boardId}/duplicate`, { method: 'POST' })).json()) as {
      id: string;
      title: string;
    };
    expect(copy.title).toBe('Sprint 12 retro (copy)');
    expect(server.boards.movesSince(copy.id, 0).length).toBe(server.boards.movesSince(boardId, 0).length);

    await server.boards.flush();
    const { boards } = (await (await api('/api/boards')).json()) as { boards: BoardCard[] };

    expect(boards.map((board) => board.id).sort()).toEqual([boardId, copy.id].sort());
    expect(boards.find((board) => board.id === boardId)?.starred).toBe(true);

    expect((await api(`/api/boards/${boardId}/star`, { method: 'DELETE' })).status).toBe(204);
  });

  it('only the owner renames or deletes', async () => {
    const other = await guestCookie();

    expect(
      (
        await api(`/api/boards/${boardId}`, { method: 'PATCH', body: JSON.stringify({ title: 'x' }) }, other)
      ).status,
    ).toBe(403);
    expect((await api(`/api/boards/${boardId}`, { method: 'DELETE' }, other)).status).toBe(403);
  });

  it('soft-deletes a board: gone from the list, from memory, and from check_room', async () => {
    expect((await api(`/api/boards/${boardId}`, { method: 'DELETE' })).status).toBe(204);
    expect(server.boards.has(boardId)).toBe(false);
    expect(await server.boards.ensureLoaded(boardId)).toBe(false);

    const { boards } = (await (await api('/api/boards')).json()) as { boards: BoardCard[] };
    expect(boards.some((board) => board.id === boardId)).toBe(false);
  });
});
