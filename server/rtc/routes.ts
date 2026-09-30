import express, { type Express } from 'express';
import {
  AccessToken,
  RoomServiceClient,
  TrackSource,
  WebhookReceiver,
} from 'livekit-server-sdk';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import type { Server } from 'socket.io';
import { z } from 'zod';

import { canManage, canView } from '@/common/constants/roles';
import { roomIdSchema, userIdSchema } from '@/common/schemas/user';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@/common/types/global';

import type { RoleResolver } from '../auth/roles';
import { type AuthDeps, identityFromRequest } from '../auth/routes';
import type { BoardStore } from '../boards/BoardStore';
import type { Config } from '../config';
import { logger } from '../logger';
import { rtcJoinsTotal, rtcParticipants } from '../ops/metrics';
import type { SocketData } from '../socket/identity';
import { boardIdFromRoomName, grantsFor, rtcRoomName } from './grants';

type IOServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

/** The part of `RoomServiceClient` moderation needs, so tests can fake it. */
export type RoomService = Pick<RoomServiceClient, 'getParticipant' | 'mutePublishedTrack'>;

export type RtcSettings = { url: string; apiKey: string; apiSecret: string };

export type RtcDeps = {
  settings: RtcSettings;
  boards: BoardStore;
  roles: RoleResolver;
  auth: AuthDeps;
  io: IOServer;
  roomService?: RoomService;
};

/**
 * Who is in which board's call, from webhooks, so people who are not in the
 * call still see who is. Best effort: a missed webhook self-corrects on the
 * next join or leave, and `room_finished` clears the board.
 */
export class CallRoster {
  private rooms = new Map<string, Set<string>>();

  participantsOf(boardId: string): string[] {
    return [...(this.rooms.get(boardId) ?? [])];
  }

  join(boardId: string, userId: string) {
    const set = this.rooms.get(boardId) ?? new Set<string>();
    set.add(userId);
    this.rooms.set(boardId, set);
  }

  leave(boardId: string, userId: string) {
    const set = this.rooms.get(boardId);
    if (!set) return;

    set.delete(userId);
    if (!set.size) this.rooms.delete(boardId);
  }

  finish(boardId: string) {
    this.rooms.delete(boardId);
  }
}

/** All four values, or the feature does not exist. */
export const rtcSettings = (config: Config): RtcSettings | null =>
  config.RTC_ENABLED && config.LIVEKIT_URL && config.LIVEKIT_API_KEY && config.LIVEKIT_API_SECRET
    ? { url: config.LIVEKIT_URL, apiKey: config.LIVEKIT_API_KEY, apiSecret: config.LIVEKIT_API_SECRET }
    : null;

const tokenBodySchema = z.object({ boardId: roomIdSchema });

const muteBodySchema = z.object({
  boardId: roomIdSchema,
  targetUserId: userIdSchema.or(z.string().min(1).max(64)),
  track: z.enum(['audio', 'video']),
});

/** Ten tokens a minute per user: a reconnect storm, not a normal session. */
const tokenLimiter = new RateLimiterMemory({ points: 10, duration: 60 });

const TOKEN_TTL = '1h';

/**
 * The HTTP side of calls. Tokens map board roles onto LiveKit grants, the
 * mute endpoint lets owners moderate, and the webhook records call metrics.
 * LiveKit carries media only; presence and everything ephemeral stay on
 * Socket.IO.
 */
export const registerRtcRoutes = (app: Express, deps: RtcDeps, roster = new CallRoster()) => {
  const { settings } = deps;
  const roomService =
    deps.roomService ??
    new RoomServiceClient(settings.url.replace(/^ws/u, 'http'), settings.apiKey, settings.apiSecret);
  const receiver = new WebhookReceiver(settings.apiKey, settings.apiSecret);
  const json = express.json({ limit: '4kb' });

  app.post('/api/rtc/token', json, async (req, res) => {
    const identity = await identityFromRequest(req, deps.auth);

    if (!identity) {
      res.status(401).json({ error: 'sign in or open a board first' });
      return;
    }

    try {
      await tokenLimiter.consume(identity.userId);
    } catch {
      res.status(429).json({ error: 'too many call tokens, slow down' });
      return;
    }

    const body = tokenBodySchema.safeParse(req.body);

    if (!body.success) {
      res.status(400).json({ error: 'boardId required' });
      return;
    }

    const { boardId } = body.data;

    if (!(await deps.boards.ensureLoaded(boardId))) {
      res.status(404).json({ error: 'no such board' });
      return;
    }

    const role = await deps.roles.roleFor(boardId, identity.userId);
    const grant = canView(role) ? grantsFor(role, boardId) : null;

    if (!grant) {
      res.status(403).json({ error: 'you do not have access to this board' });
      return;
    }

    const member = deps.boards.get(boardId)?.users.get(identity.userId);
    const name = member?.name ?? identity.name ?? 'Guest';

    const token = new AccessToken(settings.apiKey, settings.apiSecret, {
      identity: identity.userId,
      name,
      ttl: TOKEN_TTL,
      metadata: JSON.stringify({ color: member?.color ?? null, role }),
    });
    token.addGrant(grant);

    res.json({ token: await token.toJwt(), url: settings.url, role });
  });

  app.post('/api/rtc/mute', json, async (req, res) => {
    const identity = await identityFromRequest(req, deps.auth);

    if (!identity) {
      res.status(401).json({ error: 'sign in or open a board first' });
      return;
    }

    const body = muteBodySchema.safeParse(req.body);

    if (!body.success) {
      res.status(400).json({ error: 'boardId, targetUserId and track (audio|video) required' });
      return;
    }

    const { boardId, targetUserId, track } = body.data;

    if (!(await deps.boards.ensureLoaded(boardId))) {
      res.status(404).json({ error: 'no such board' });
      return;
    }

    if (!canManage(await deps.roles.roleFor(boardId, identity.userId))) {
      res.status(403).json({ error: 'only the owner can mute participants' });
      return;
    }

    try {
      const participant = await roomService.getParticipant(rtcRoomName(boardId), targetUserId);
      const source = track === 'audio' ? TrackSource.MICROPHONE : TrackSource.CAMERA;
      const published = participant.tracks.find((info) => info.source === source && !info.muted);

      if (!published) {
        res.status(404).json({ error: 'that participant is not publishing that track' });
        return;
      }

      await roomService.mutePublishedTrack(rtcRoomName(boardId), targetUserId, published.sid, true);

      // Told through the room so the target's tab can explain what happened.
      deps.io.to(boardId).emit('rtc_moderated', targetUserId, track);

      res.status(204).end();
    } catch (error) {
      logger.warn({ err: error, boardId, targetUserId }, 'mute failed');
      res.status(502).json({ error: 'the call server did not accept the request' });
    }
  });

  app.post('/api/rtc/webhook', express.raw({ type: '*/*', limit: '64kb' }), async (req, res) => {
    try {
      const body = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body ?? '');
      const event = await receiver.receive(body, req.header('authorization'));
      const boardId = event.room ? boardIdFromRoomName(event.room.name) : null;
      const identity = event.participant?.identity;

      if (event.event === 'participant_joined') {
        rtcJoinsTotal.inc();
        rtcParticipants.inc();
        if (boardId && identity) roster.join(boardId, identity);
      } else if (event.event === 'participant_left') {
        rtcParticipants.dec();
        if (boardId && identity) roster.leave(boardId, identity);
      } else if (event.event === 'room_finished' && event.room) {
        rtcParticipants.dec(event.room.numParticipants ?? 0);
        if (boardId) roster.finish(boardId);
      }

      if (boardId) deps.io.to(boardId).emit('call_participants', roster.participantsOf(boardId));

      logger.debug({ event: event.event, room: event.room?.name }, 'livekit webhook');
      res.json({});
    } catch (error) {
      logger.warn({ err: error }, 'rejected a livekit webhook');
      res.status(401).json({ error: 'invalid webhook signature' });
    }
  });
};
