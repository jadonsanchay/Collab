import { randomUUID } from 'crypto';
import type { AddressInfo } from 'net';
import { io as connectClient, type Socket } from 'socket.io-client';
import { expect, it, vi } from 'vitest';

import { PROTOCOL_VERSION } from '@/common/constants/protocol';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@/common/types/global';

import { createAppServer } from '../app';
import { logger } from '../logger';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const PAYLOAD_COUNT = 200;
const SEED = 20260921;

/** Every event a client can send. */
const EVENTS: (keyof ClientToServerEvents)[] = [
  'check_room',
  'draw',
  'cursor',
  'undo',
  'create_room',
  'join_room',
  'joined_room',
  'leave_room',
  'send_msg',
];

const MODULUS = 2147483647;

/**
 * A Lehmer generator. Statistically unremarkable and that is fine — it only
 * has to be deterministic, so that a failure is reproducible from the seed.
 * A fuzz test that fails once and never again is worse than no test at all.
 * Both operands stay well inside the safe integer range, so the sequence is
 * exact rather than merely repeatable.
 */
const makeRandom = (seed: number) => {
  let state = (seed % (MODULUS - 1)) + 1;

  return () => {
    state = (state * 48271) % MODULUS;
    return (state - 1) / (MODULUS - 1);
  };
};

const random = makeRandom(SEED);

const pick = <T>(values: T[]): T =>
  values[Math.floor(random() * values.length)];

/**
 * A grab bag of values a handler might choke on: wrong primitives, missing
 * fields, wrong nesting, and values that break arithmetic or string
 * assumptions. Depth-limited so nothing recurses forever.
 */
const randomValue = (depth = 0): unknown => {
  const leaves: unknown[] = [
    undefined,
    null,
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER,
    true,
    false,
    '',
    'a',
    '../../etc/passwd',
    '{"not":"parsed"}',
    '\u0000\u001b[31m',
    '🎨'.repeat(64),
    'x'.repeat(1000),
  ];

  if (depth > 2 || random() < 0.6) return pick(leaves);

  if (random() < 0.5) {
    return Array.from({ length: Math.floor(random() * 4) }, () =>
      randomValue(depth + 1),
    );
  }

  return {
    path: randomValue(depth + 1),
    options: randomValue(depth + 1),
    circle: randomValue(depth + 1),
    rect: randomValue(depth + 1),
    img: randomValue(depth + 1),
    [pick(['id', 'timestamp', '__proto__', 'toString'])]: randomValue(
      depth + 1,
    ),
  };
};

/**
 * Throws malformed payloads at every event, then checks two things: that the
 * server is still answering, and that validation actually engaged. The second
 * half matters — without it this test would keep passing if every schema were
 * deleted, since unvalidated garbage mostly flows through harmlessly.
 */
it(
  `survives ${PAYLOAD_COUNT} malformed payloads across every event`,
  async () => {
    const { server, io } = createAppServer({
      nextHandler: (_req, res) => {
        res.end('next');
      },
    });

    let client: ClientSocket | undefined;

    // Every rejected payload is logged here, so this is the evidence that the
    // schemas ran at all.
    const rejections = vi.spyOn(logger, 'warn');

    try {
      await new Promise<void>((resolve) => {
        server.listen(0, resolve);
      });

      const { port } = server.address() as AddressInfo;
      client = connectClient(`http://localhost:${port}`, {
        transports: ['websocket'],
        forceNew: true,
        auth: { userId: randomUUID(), protocolVersion: PROTOCOL_VERSION },
      });

      const connected = client;
      await new Promise<void>((resolve, reject) => {
        connected.once('connect', resolve);
        connected.once('connect_error', reject);
      });

      for (let i = 0; i < PAYLOAD_COUNT; i += 1) {
        const event = EVENTS[i % EVENTS.length];
        const args = Array.from({ length: Math.floor(random() * 4) }, () =>
          randomValue(),
        );

        // Deliberately untyped: the point is payloads the contract forbids.
        (connected.emit as (name: string, ...rest: unknown[]) => void)(
          event,
          ...args,
        );
      }

      // A real round trip after the barrage. Had any payload killed the
      // process or the connection, this would time out.
      const answered = new Promise<boolean>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('server stopped answering check_room')),
          4000,
        );

        connected.once('room_exists', (exists) => {
          clearTimeout(timer);
          resolve(exists);
        });
      });

      connected.emit('check_room', 'still-here');

      await expect(answered).resolves.toBe(false);
      expect(connected.connected).toBe(true);

      // Most of the 200 payloads are invalid, so a run with no rejections at
      // all would mean the schemas are not wired in.
      expect(rejections).toHaveBeenCalled();
    } finally {
      rejections.mockRestore();
      client?.disconnect();
      await new Promise<void>((resolve) => {
        io.close(() => resolve());
      });
    }
  },
  30000,
);
