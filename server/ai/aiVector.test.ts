import { randomUUID } from 'crypto';
import type { AddressInfo } from 'net';
import { io as connectClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PROTOCOL_VERSION } from '@/common/constants/protocol';
import type {
  AiStatusUpdate,
  ClientToServerEvents,
  ServerToClientEvents,
} from '@/common/types/global';
import { readAll } from '@/common/vector/doc';

import { createAppServer } from '../app';
import { loadConfig } from '../config';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const config = {
  ...loadConfig({}),
  USER_GRACE_MS: 60_000,
  ROOM_GRACE_MS: 60_000,
  AI_ENABLED: true,
  AI_FAKE: true,
};

const untilTrue = async (check: () => boolean, ms = 5000) => {
  const started = Date.now();

  while (!check() && Date.now() - started < ms) {
    // eslint-disable-next-line no-await-in-loop -- polling
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }

  expect(check()).toBe(true);
};

describe('Sketch on an objects board', () => {
  let server: ReturnType<typeof createAppServer>;
  let alice: ClientSocket;
  let bob: ClientSocket;
  let roomId: string;

  const connect = async () => {
    const { port } = server.server.address() as AddressInfo;
    const socket: ClientSocket = connectClient(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: { userId: randomUUID(), protocolVersion: PROTOCOL_VERSION },
    });

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });

    return socket;
  };

  beforeAll(async () => {
    server = createAppServer({
      nextHandler: (_req, res) => {
        res.end('next');
      },
      config,
      aiOptions: {
        timing: { minMoveMs: 10, maxMoveMs: 30, maxTotalMs: 400 },
        participant: { tickMs: 4, idleLeaveMs: 60_000 },
      },
    });
    await new Promise<void>((resolve) => {
      server.server.listen(0, () => resolve());
    });

    alice = await connect();
    bob = await connect();

    const created = new Promise<string>((resolve) => {
      alice.once('created', resolve);
    });
    alice.emit('create_room', 'Alice', { engine: 'vector' });
    roomId = await created;
    alice.emit('joined_room');

    const joined = new Promise<void>((resolve) => {
      bob.once('joined', () => resolve());
    });
    bob.emit('join_room', roomId, 'Bob');
    await joined;
    bob.emit('joined_room');
  });

  afterAll(async () => {
    alice.disconnect();
    bob.disconnect();
    server.ai?.stop();
    server.rooms.stop();
    await server.vectorDocs.stop();
    await new Promise<void>((resolve) => {
      server.io.close(() => resolve());
    });
  });

  it('writes the program as objects into the document, animates the cursor, and undoes them all', async () => {
    const statuses: AiStatusUpdate[] = [];
    const cursors: [number, number][] = [];
    let moves = 0;

    bob.on('ai_status', (update) => statuses.push(update));
    bob.on('cursor_moved', (_userId, x, y) => cursors.push([x, y]));
    bob.on('user_draw', () => {
      moves += 1;
    });

    const requestId = randomUUID();
    const viewport = { x: -100, y: -100, width: 1200, height: 800 };

    alice.emit('ai_request', { requestId, kind: 'draw', prompt: 'a house', viewport });

    await untilTrue(() => statuses.some((update) => update.status === 'done'));

    const doc = server.vectorDocs.get(roomId)?.doc;
    expect(doc).toBeDefined();

    const objects = readAll(doc!);

    // The fake "draw" program has five primitives; every one became an object.
    expect(objects).toHaveLength(5);
    objects.forEach((object) => expect(object.meta).toEqual({ requestId }));

    // Inside the middle 60 percent of what the requester sees.
    const target = { left: -100 + 240, top: -100 + 160, right: -100 + 960, bottom: -100 + 640 };
    objects.forEach((object) => {
      expect(Math.min(object.x, object.x + object.w)).toBeGreaterThanOrEqual(target.left - 10);
      expect(Math.min(object.y, object.y + object.h)).toBeGreaterThanOrEqual(target.top - 10);
      expect(Math.max(object.x, object.x + object.w)).toBeLessThanOrEqual(target.right + 10);
      expect(Math.max(object.y, object.y + object.h)).toBeLessThanOrEqual(target.bottom + 10);
    });

    // The pen was seen moving, in world coordinates; nothing was drawn as a move.
    expect(cursors.length).toBeGreaterThan(0);
    expect(moves).toBe(0);
    expect(server.boards.movesSince(roomId, 0)).toHaveLength(0);

    // Only the requester can undo, and then everything from the request goes.
    bob.emit('ai_undo', requestId);
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
    expect(readAll(doc!)).toHaveLength(5);

    alice.emit('ai_undo', requestId);
    await untilTrue(() => readAll(doc!).length === 0);
  });
});
