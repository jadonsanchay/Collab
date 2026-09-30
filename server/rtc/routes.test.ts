import { createHash, randomUUID } from 'crypto';
import type { AddressInfo } from 'net';
import { eq } from 'drizzle-orm';
import { AccessToken, TokenVerifier, TrackSource } from 'livekit-server-sdk';
import { io as connectClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { PROTOCOL_VERSION } from '@/common/constants/protocol';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@/common/types/global';

import { createAppServer } from '../app';
import { DbPersistence } from '../boards/dbPersistence';
import { loadConfig } from '../config';
import { createPglite, type Database } from '../db/client';
import { boards } from '../db/schema';
import type { RoomService } from './routes';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const KEY = 'devkey';
const SECRET = 'devsecret-devsecret-devsecret-devsecret';

const config = {
  ...loadConfig({}),
  RTC_ENABLED: true,
  LIVEKIT_URL: 'wss://calls.example.test',
  LIVEKIT_API_KEY: KEY,
  LIVEKIT_API_SECRET: SECRET,
  USER_GRACE_MS: 60_000,
};

describe('call tokens, moderation and webhooks', () => {
  let database: Database;
  let server: ReturnType<typeof createAppServer>;
  let origin: string;
  let boardId: string;
  let ownerCookie: string;
  let ownerId: string;
  let ownerSocket: ClientSocket;
  const roomService: RoomService = {
    getParticipant: vi.fn(async () => ({
      tracks: [{ source: TrackSource.MICROPHONE, sid: 'TR_mic', muted: false }],
    })) as unknown as RoomService['getParticipant'],
    mutePublishedTrack: vi.fn(async () => ({})) as unknown as RoomService['mutePublishedTrack'],
  };

  const guestCookie = async (userId = randomUUID()) => {
    const response = await fetch(`${origin}/api/me/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId }),
    });

    return {
      userId,
      cookie: response.headers.getSetCookie().map((line) => line.split(';')[0]).join('; '),
    };
  };

  const post = (pathname: string, body: unknown, cookie: string) =>
    fetch(`${origin}${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    database = await createPglite();
    server = createAppServer({
      nextHandler: (_req, res) => {
        res.end('next');
      },
      config,
      persistence: new DbPersistence(database, { flushMs: 5 }),
      database,
      roomService,
    });

    await new Promise<void>((resolve) => {
      server.server.listen(0, () => resolve());
    });
    origin = `http://localhost:${(server.server.address() as AddressInfo).port}`;

    // The owner creates a board over the socket, so it exists in memory and on record.
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
    ownerSocket.emit('create_room', 'Owner');
    boardId = await created;
    ownerSocket.emit('joined_room');
    await server.boards.flush();
  }, 60_000);

  afterAll(async () => {
    ownerSocket.disconnect();
    server.rooms.stop();
    await server.boards.flush();
    await new Promise<void>((resolve) => {
      server.io.close(() => resolve());
    });
    await database.close();
  });

  it('advertises calls', () => {
    expect(server.features.rtc).toBe(true);
  });

  it('mints an editor token that may publish, with the board room and the user’s name', async () => {
    const response = await post('/api/rtc/token', { boardId }, ownerCookie);

    expect(response.status).toBe(200);

    const { token, url, role } = (await response.json()) as { token: string; url: string; role: string };

    expect(url).toBe('wss://calls.example.test');
    expect(role).toBe('owner');

    const claims = await new TokenVerifier(KEY, SECRET).verify(token);

    expect(claims.sub).toBe(ownerId);
    expect(claims.name).toBe('Owner');
    expect(claims.video).toMatchObject({
      room: `board:${boardId}`,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
    });
  });

  it('mints a viewer token that cannot publish once the link role is viewer', async () => {
    await database.db.update(boards).set({ linkRole: 'viewer' }).where(eq(boards.id, boardId));
    server.roles.invalidate(boardId);

    const stranger = await guestCookie();
    const response = await post('/api/rtc/token', { boardId }, stranger.cookie);
    const { token } = (await response.json()) as { token: string };
    const claims = await new TokenVerifier(KEY, SECRET).verify(token);

    expect(claims.video).toMatchObject({ canPublish: false, canSubscribe: true });
  });

  it('refuses non-members of a private board, unknown boards, and anonymous callers', async () => {
    await database.db.update(boards).set({ visibility: 'private' }).where(eq(boards.id, boardId));
    server.roles.invalidate(boardId);

    const stranger = await guestCookie();

    expect((await post('/api/rtc/token', { boardId }, stranger.cookie)).status).toBe(403);
    expect((await post('/api/rtc/token', { boardId: 'nope0000' }, stranger.cookie)).status).toBe(404);
    expect((await post('/api/rtc/token', { boardId }, '')).status).toBe(401);
  });

  it('rate limits token minting', async () => {
    const spammer = await guestCookie();
    const statuses: number[] = [];

    for (let i = 0; i < 11; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- sequential on purpose
      statuses.push((await post('/api/rtc/token', { boardId }, spammer.cookie)).status);
    }

    expect(statuses.slice(0, 10).every((status) => status === 403)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('lets only the owner mute, and tells the room who was moderated', async () => {
    const stranger = await guestCookie();

    expect(
      (await post('/api/rtc/mute', { boardId, targetUserId: randomUUID(), track: 'audio' }, stranger.cookie))
        .status,
    ).toBe(403);

    const target = randomUUID();
    const moderated = new Promise<[string, string]>((resolve) => {
      ownerSocket.once('rtc_moderated', (userId, track) => resolve([userId, track]));
    });

    const response = await post('/api/rtc/mute', { boardId, targetUserId: target, track: 'audio' }, ownerCookie);

    expect(response.status).toBe(204);
    expect(roomService.mutePublishedTrack).toHaveBeenCalledWith(`board:${boardId}`, target, 'TR_mic', true);
    expect(await moderated).toEqual([target, 'audio']);

    // Not publishing video: nothing to mute.
    expect(
      (await post('/api/rtc/mute', { boardId, targetUserId: target, track: 'video' }, ownerCookie)).status,
    ).toBe(404);
  });

  it('accepts a signed webhook, updates the roster, and rejects a forged one', async () => {
    const participant = randomUUID();
    const body = JSON.stringify({
      event: 'participant_joined',
      id: 'evt_1',
      createdAt: Math.floor(Date.now() / 1000),
      room: { name: `board:${boardId}`, numParticipants: 1 },
      participant: { identity: participant },
    });

    const signer = new AccessToken(KEY, SECRET, { identity: 'livekit', ttl: '1m' });
    signer.sha256 = createHash('sha256').update(body).digest('base64');
    const authorization = await signer.toJwt();

    const roster = new Promise<string[]>((resolve) => {
      ownerSocket.once('call_participants', resolve);
    });

    const accepted = await fetch(`${origin}/api/rtc/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/webhook+json', authorization },
      body,
    });

    expect(accepted.status).toBe(200);
    expect(await roster).toEqual([participant]);

    const metrics = await (await fetch(`${origin}/metrics`)).text();
    expect(metrics).toMatch(/collab_rtc_joins_total 1/);

    const forged = await fetch(`${origin}/api/rtc/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/webhook+json', authorization: 'not-a-token' },
      body,
    });

    expect(forged.status).toBe(401);
  });
});
