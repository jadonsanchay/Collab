import { randomUUID } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import path from 'path';
import { io as connectClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PROTOCOL_VERSION } from '@/common/constants/protocol';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@/common/types/global';

import { createAppServer } from '../app';
import { loadConfig } from '../config';
import { makeMove } from '../testing/fixtures';
import { LocalStorage } from './local';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** A 1x1 transparent PNG. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('upload routes with local storage', () => {
  let dir: string;
  let server: ReturnType<typeof createAppServer>;
  let origin: string;
  const userId = randomUUID();

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'collab-uploads-'));
    server = createAppServer({
      nextHandler: (_req, res) => {
        res.end('next');
      },
      config: { ...loadConfig({}), UPLOADS_DIR: dir, UPLOAD_MAX_BYTES: 4096 },
      storage: new LocalStorage({ dir, secret: 'test-secret' }),
    });

    await new Promise<void>((resolve) => {
      server.server.listen(0, () => resolve());
    });

    origin = `http://localhost:${(server.server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.rooms.stop();
    await new Promise<void>((resolve) => {
      server.io.close(() => resolve());
    });
    await rm(dir, { recursive: true, force: true });
  });

  const presign = (body: unknown, headers: Record<string, string> = { 'x-collab-user': userId }) =>
    fetch(`${origin}/api/uploads/presign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  it('presigns, accepts the PUT, and serves the object', async () => {
    const response = await presign({ contentType: 'image/png', size: PNG_BYTES.length });

    expect(response.status).toBe(200);

    const upload = (await response.json()) as { url: string; publicUrl: string; key: string };

    expect(upload.key).toMatch(/^uploads\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/u);
    expect(upload.publicUrl).toBe(`/uploads/${upload.key}`);

    const put = await fetch(`${origin}${upload.url}`, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: PNG_BYTES,
    });

    expect(put.status).toBe(204);

    const served = await fetch(`${origin}${upload.publicUrl}`);

    expect(served.status).toBe(200);
    expect(Buffer.from(await served.arrayBuffer()).equals(PNG_BYTES)).toBe(true);
  });

  it('refuses a presign without an identity, with a bad body, or over the size cap', async () => {
    expect((await presign({ contentType: 'image/png', size: 10 }, {})).status).toBe(401);
    expect((await presign({ contentType: 'text/html', size: 10 })).status).toBe(400);
    expect((await presign({ contentType: 'image/png', size: 5000 })).status).toBe(413);
  });

  it('refuses a PUT with a tampered signature or an oversized body', async () => {
    const response = await presign({ contentType: 'image/png', size: 100 });
    const upload = (await response.json()) as { url: string };

    const tampered = await fetch(`${origin}${upload.url.replace(/sig=[^&]+/u, 'sig=nope')}`, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: PNG_BYTES,
    });

    expect(tampered.status).toBe(403);

    const oversized = await fetch(`${origin}${upload.url}`, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: Buffer.alloc(200),
    });

    expect(oversized.status).toBe(413);
  });

  it('offloads an inline base64 image from a draw into storage', async () => {
    const socket: ClientSocket = connectClient(origin, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: { userId: randomUUID(), protocolVersion: PROTOCOL_VERSION },
    });

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });

    const created = new Promise<string>((resolve) => {
      socket.once('created', resolve);
    });
    socket.emit('create_room', 'Alice');
    const roomId = await created;
    socket.emit('joined_room');

    const echoed = new Promise<{ img: { url?: string; base64?: string } }>((resolve) => {
      socket.once('your_move', resolve);
    });

    const dataUrl = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;
    const move = makeMove({
      path: [[10, 10]],
      img: { base64: dataUrl },
      options: { ...makeMove().options, shape: 'image' },
    });
    socket.emit('draw', move);

    const stored = await echoed;

    expect(stored.img.base64).toBeUndefined();
    expect(stored.img.url).toBe(`/uploads/uploads/${roomId}/${move.clientId}.png`);

    const served = await fetch(`${origin}${stored.img.url}`);
    expect(Buffer.from(await served.arrayBuffer()).equals(PNG_BYTES)).toBe(true);

    socket.disconnect();
  });
});
