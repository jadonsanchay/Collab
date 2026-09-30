import { randomUUID } from 'crypto';
import type { AddressInfo } from 'net';
import { io as connectClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AI_USER_ID, AI_USER_NAME } from '@/common/constants/ai';
import { PROTOCOL_VERSION } from '@/common/constants/protocol';
import type {
  AiStatusUpdate,
  ClientToServerEvents,
  Features,
  Move,
  ServerToClientEvents,
} from '@/common/types/global';

import { createAppServer } from '../app';
import { loadConfig } from '../config';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type Identified = ClientSocket & { userId: string; features: Promise<Features> };

const EVENT_TIMEOUT_MS = 5000;

/** Resolves with the arguments of the next `event` that satisfies `when`. */
const waitFor = <E extends keyof ServerToClientEvents>(
  socket: ClientSocket,
  event: E,
  when: (...args: Parameters<ServerToClientEvents[E]>) => boolean = () => true,
  timeoutMs = EVENT_TIMEOUT_MS,
): Promise<Parameters<ServerToClientEvents[E]>> =>
  new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;

    const listener = (...args: unknown[]) => {
      const typed = args as Parameters<ServerToClientEvents[E]>;

      if (!when(...typed)) return;

      if (timer) clearTimeout(timer);
      socket.off(event, listener as never);
      resolve(typed);
    };

    timer = setTimeout(() => {
      socket.off(event, listener as never);
      reject(new Error(`timed out waiting for "${String(event)}"`));
    }, timeoutMs);

    socket.on(event, listener as never);
  });

/** Records every `event` until stopped. */
const collect = <E extends keyof ServerToClientEvents>(
  socket: ClientSocket,
  event: E,
) => {
  const seen: Parameters<ServerToClientEvents[E]>[] = [];
  const listener = (...args: unknown[]) => {
    seen.push(args as Parameters<ServerToClientEvents[E]>);
  };

  socket.on(event, listener as never);

  return { seen, stop: () => socket.off(event, listener as never) };
};

const expectNoEvent = async <E extends keyof ServerToClientEvents>(
  socket: ClientSocket,
  event: E,
  ms = 300,
) => {
  const { seen, stop } = collect(socket, event);

  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

  stop();
  expect(seen, `expected no "${String(event)}"`).toHaveLength(0);
};

const baseConfig = {
  ...loadConfig({}),
  USER_GRACE_MS: 200,
  ROOM_GRACE_MS: 500,
  SWEEP_INTERVAL_MS: 50,
};

/** Animation shrunk so a whole request completes in well under a second. */
const fastAi = {
  timing: { minMoveMs: 10, maxMoveMs: 30, maxTotalMs: 400 },
  participant: { tickMs: 4, idleLeaveMs: 60_000 },
};

const bootServer = (
  config: typeof baseConfig,
  aiOptions: Parameters<typeof createAppServer>[0]['aiOptions'] = fastAi,
) => {
  const server = createAppServer({
    nextHandler: (_req, res) => {
      res.end('next');
    },
    config,
    aiOptions,
  });

  return new Promise<typeof server>((resolve) => {
    server.server.listen(0, () => resolve(server));
  });
};

const connectTo = async (
  server: ReturnType<typeof createAppServer>,
): Promise<Identified> => {
  const { port } = server.server.address() as AddressInfo;
  const userId = randomUUID();
  const socket: ClientSocket = connectClient(`http://localhost:${port}`, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    auth: { userId, protocolVersion: PROTOCOL_VERSION },
  });

  // Registered before connecting: `features` is the first thing the server
  // sends, and a listener attached afterwards could be too late in theory.
  const features = new Promise<Features>((resolve) => {
    socket.once('features', resolve);
  });

  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });

  return Object.assign(socket, { userId, features });
};

const shutdown = async (server: ReturnType<typeof createAppServer>) => {
  server.ai?.stop();
  server.rooms.stop();
  await new Promise<void>((resolve) => {
    server.io.close(() => resolve());
  });
};

/** Alice creates a room and Bob joins it; both have loaded the room snapshot. */
const roomWithTwo = async (server: ReturnType<typeof createAppServer>) => {
  const alice = await connectTo(server);
  const bob = await connectTo(server);

  const created = waitFor(alice, 'created');
  alice.emit('create_room', 'Alice');
  const [roomId] = await created;
  alice.emit('joined_room');

  const joined = waitFor(bob, 'joined');
  bob.emit('join_room', roomId, 'Bob');
  const [, failed] = await joined;
  expect(failed).toBeFalsy();

  const snapshot = waitFor(bob, 'room');
  bob.emit('joined_room');
  await snapshot;

  return { alice, bob, roomId };
};

const viewport = { x: 0, y: 0, width: 1200, height: 800 };

describe('AI teammate with the fake agent', () => {
  let server: ReturnType<typeof createAppServer>;
  let alice: Identified;
  let bob: Identified;
  let roomId: string;
  let requestId: string;
  let drawn: Move[];

  beforeAll(async () => {
    server = await bootServer({ ...baseConfig, AI_ENABLED: true, AI_FAKE: true });
    ({ alice, bob, roomId } = await roomWithTwo(server));
  });

  afterAll(async () => {
    alice.disconnect();
    bob.disconnect();
    await shutdown(server);
  });

  it('tells every client the feature is on', async () => {
    expect(server.ai).not.toBeNull();
    await expect(alice.features).resolves.toMatchObject({ ai: true, rewind: true });
  });

  it('runs a draw request: Sketch joins, its cursor moves, it draws, it reports done', async () => {
    const newUsers = collect(bob, 'new_user');
    const cursors = collect(bob, 'cursor_moved');
    const draws = collect(bob, 'user_draw');
    const statuses = collect(bob, 'ai_status');
    const strokes = collect(bob, 'live_stroke_start');
    const messages = collect(bob, 'new_msg');
    const ownDraws = collect(alice, 'user_draw');

    requestId = randomUUID();

    const done = waitFor(
      bob,
      'ai_status',
      (update) => update.requestId === requestId && update.status === 'done',
    );

    alice.emit('ai_request', { requestId, kind: 'draw', prompt: 'a boat', viewport });

    const [finalUpdate] = await done;

    // A moment for the trailing chat message to land.
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });

    [newUsers, cursors, draws, statuses, strokes, messages, ownDraws].forEach((c) => c.stop());

    expect(newUsers.seen).toContainEqual([AI_USER_ID, AI_USER_NAME, expect.any(String)]);

    expect(cursors.seen.length).toBeGreaterThan(0);
    expect(cursors.seen.every(([userId]) => userId === AI_USER_ID)).toBe(true);

    // The fake `draw` program: rect, roof line, door, label, arrow (two moves).
    expect(draws.seen).toHaveLength(6);
    drawn = draws.seen.map(([move]) => move);
    expect(drawn.every((move) => move.userId === AI_USER_ID)).toBe(true);
    expect(drawn.every((move) => move.meta?.requestId === requestId)).toBe(true);
    expect(draws.seen.every(([, userId]) => userId === AI_USER_ID)).toBe(true);
    // The requester gets the same moves as everyone else.
    expect(ownDraws.seen).toHaveLength(6);

    // Lines are streamed live while the cursor draws them.
    expect(strokes.seen.length).toBe(3);
    expect(strokes.seen.every(([userId]) => userId === AI_USER_ID)).toBe(true);

    const order = statuses.seen
      .map(([update]) => update as AiStatusUpdate)
      .filter((update) => update.requestId === requestId)
      .map((update) => update.status);

    expect(order[0]).toBe('queued');
    expect(order).toContain('thinking');
    expect(order).toContain('drawing');
    expect(order[order.length - 1]).toBe('done');
    expect(finalUpdate.userId).toBe(alice.userId);
    expect(finalUpdate.kind).toBe('draw');

    expect(messages.seen).toContainEqual([AI_USER_ID, expect.stringContaining('a boat')]);

    // Stored server-side under Sketch, so a late joiner replays them too.
    expect(server.rooms.get(roomId)?.usersMoves.get(AI_USER_ID)).toHaveLength(6);
  });

  it('refuses to undo someone else’s request', async () => {
    bob.emit('ai_undo', requestId);

    await expectNoEvent(bob, 'moves_removed');
    expect(server.rooms.get(roomId)?.usersMoves.get(AI_USER_ID)).toHaveLength(6);
  });

  it('undoes the whole request on every client as one action', async () => {
    const bobRemoved = waitFor(bob, 'moves_removed');
    const aliceRemoved = waitFor(alice, 'moves_removed');

    alice.emit('ai_undo', requestId);

    const [[bobIds], [aliceIds]] = await Promise.all([bobRemoved, aliceRemoved]);
    const expected = drawn.map((move) => move.id).sort();

    expect([...bobIds].sort()).toEqual(expected);
    expect([...aliceIds].sort()).toEqual(expected);
    expect(server.rooms.get(roomId)?.usersMoves.get(AI_USER_ID)).toHaveLength(0);
  });

  it('answers a cleanup without a selection with an error status', async () => {
    const id = randomUUID();
    const status = waitFor(alice, 'ai_status', (update) => update.requestId === id);

    alice.emit('ai_request', { requestId: id, kind: 'cleanup', viewport });

    const [update] = await status;

    expect(update.status).toBe('error');
    expect(update.message).toMatch(/select/i);
  });

  it('drops a malformed request without answering', async () => {
    alice.emit('ai_request', { requestId: 'nope', kind: 'draw', viewport } as never);

    await expectNoEvent(alice, 'ai_status');
  });

  it('keeps Sketch out of the room cap and out of the offline state', async () => {
    const room = server.rooms.get(roomId);
    const sketch = room?.users.get(AI_USER_ID);

    expect(sketch?.synthetic).toBe(true);
    expect(server.rooms.isOffline(roomId, AI_USER_ID)).toBe(false);
  });
});

describe('AI limits', () => {
  it('reports rate_limited once the room budget is spent', async () => {
    const server = await bootServer(
      { ...baseConfig, AI_ENABLED: true, AI_FAKE: true },
      { ...fastAi, limits: { roomRequests: 1, roomWindowS: 600 } },
    );
    const { alice, bob } = await roomWithTwo(server);

    try {
      const first = randomUUID();
      const firstDone = waitFor(
        alice,
        'ai_status',
        (update) => update.requestId === first && update.status === 'done',
      );
      alice.emit('ai_request', { requestId: first, kind: 'summarize', viewport });
      await firstDone;

      const second = randomUUID();
      const limited = waitFor(alice, 'ai_status', (update) => update.requestId === second);
      alice.emit('ai_request', { requestId: second, kind: 'draw', viewport });

      const [update] = await limited;

      expect(update.status).toBe('rate_limited');
    } finally {
      alice.disconnect();
      bob.disconnect();
      await shutdown(server);
    }
  });

  it('reports rate_limited when the queue is full', async () => {
    // Concurrency one and no backlog: the second request has nowhere to go.
    const server = await bootServer(
      { ...baseConfig, AI_ENABLED: true, AI_FAKE: true },
      {
        timing: { minMoveMs: 200, maxMoveMs: 300, maxTotalMs: 5000 },
        participant: { tickMs: 20, idleLeaveMs: 60_000 },
        queue: { concurrency: 1, maxLength: 0, timeoutMs: 10_000 },
      },
    );
    const { alice, bob } = await roomWithTwo(server);

    try {
      const first = randomUUID();
      const started = waitFor(
        alice,
        'ai_status',
        (update) => update.requestId === first && update.status === 'thinking',
      );
      alice.emit('ai_request', { requestId: first, kind: 'draw', viewport });
      await started;

      const second = randomUUID();
      // `queued` means accepted; the verdict on the queue comes right after.
      const full = waitFor(
        bob,
        'ai_status',
        (update) => update.requestId === second && update.status !== 'queued',
      );
      bob.emit('ai_request', { requestId: second, kind: 'draw', viewport });

      const [update] = await full;

      expect(update.status).toBe('rate_limited');
    } finally {
      alice.disconnect();
      bob.disconnect();
      await shutdown(server);
    }
  });
});

describe('AI switched off', () => {
  it('advertises no AI and ignores AI events entirely', async () => {
    const server = await bootServer({ ...baseConfig, AI_ENABLED: false });
    const { alice, bob } = await roomWithTwo(server);

    try {
      expect(server.ai).toBeNull();
      await expect(alice.features).resolves.toMatchObject({ ai: false });

      alice.emit('ai_request', { requestId: randomUUID(), kind: 'draw', viewport });

      await expectNoEvent(bob, 'ai_status');
      await expectNoEvent(bob, 'new_user');
    } finally {
      alice.disconnect();
      bob.disconnect();
      await shutdown(server);
    }
  });

  it('stays off when enabled without any agent available', async () => {
    const server = await bootServer({ ...baseConfig, AI_ENABLED: true, AI_FAKE: false }, {});

    try {
      expect(server.ai).toBeNull();
      expect(server.features.ai).toBe(false);
    } finally {
      await shutdown(server);
    }
  });
});
