import { randomUUID } from 'crypto';
import type { AddressInfo } from 'net';
import { io as connectClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PROTOCOL_VERSION } from '@/common/constants/protocol';
import type { ClientToServerEvents, ServerToClientEvents } from '@/common/types/global';
import { readAll } from '@/common/vector/doc';

import { createAppServer } from '../app';
import { loadConfig } from '../config';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

describe('templates over create_room', () => {
  let server: ReturnType<typeof createAppServer>;
  let socket: ClientSocket;

  const create = (options: { engine: 'raster' | 'vector'; templateId?: string }) =>
    new Promise<string>((resolve) => {
      socket.once('created', resolve);
      socket.emit('create_room', 'Alice', options);
    });

  beforeAll(async () => {
    server = createAppServer({
      nextHandler: (_req, res) => {
        res.end('next');
      },
      config: { ...loadConfig({ DEFAULT_ENGINE: 'raster' }), USER_GRACE_MS: 60_000 },
    });
    await new Promise<void>((resolve) => {
      server.server.listen(0, () => resolve());
    });
    const { port } = server.server.address() as AddressInfo;
    socket = connectClient(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: { userId: randomUUID(), protocolVersion: PROTOCOL_VERSION },
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
  });

  afterAll(async () => {
    socket.disconnect();
    server.rooms.stop();
    await server.vectorDocs.stop();
    await new Promise<void>((resolve) => {
      server.io.close(() => resolve());
    });
  });

  it('seeds an objects board with the template as objects and names it', async () => {
    const roomId = await create({ engine: 'vector', templateId: 'kanban' });
    const room = server.boards.get(roomId);

    expect(room?.title).toBe('Kanban');
    expect(room?.engine).toBe('vector');

    const objects = readAll(server.vectorDocs.get(roomId)!.doc);
    expect(objects.length).toBeGreaterThan(5);
    expect(objects.map((object) => object.type)).toEqual(expect.arrayContaining(['shape', 'text']));
    expect(server.boards.movesSince(roomId, 0)).toHaveLength(0);
  });

  it('seeds a drawing board with the template as moves', async () => {
    const roomId = await create({ engine: 'raster', templateId: 'retro' });

    expect(server.boards.get(roomId)?.title).toBe('Retrospective');
    expect(server.boards.movesSince(roomId, 0).length).toBeGreaterThan(5);
  });

  it('serves the template list in every storage mode', async () => {
    const { port } = server.server.address() as AddressInfo;
    const list = (await (await fetch(`http://localhost:${port}/api/templates`)).json()) as { id: string }[];

    expect(list.map((template) => template.id)).toEqual(expect.arrayContaining(['blank', 'kanban', 'swot']));
  });
});
