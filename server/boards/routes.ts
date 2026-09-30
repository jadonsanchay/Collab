import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import express, { type Express, type Request, type Response } from 'express';
import type { Server } from 'socket.io';
import { z } from 'zod';

import { canManage, canView, GRANTABLE_ROLES, type Role } from '@/common/constants/roles';
import { renameRoomSchema } from '@/common/schemas/events';
import { roomIdSchema } from '@/common/schemas/user';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@/common/types/global';

import type { RoleResolver } from '../auth/roles';
import { type AuthDeps, identityFromRequest } from '../auth/routes';
import type { Identity } from '../auth/session';
import type { Db } from '../db/client';
import { boardMembers, boards, boardStars } from '../db/schema';
import { logger } from '../logger';
import type { SocketData } from '../socket/identity';
import type { ObjectStorage } from '../storage';
import type { BoardStore } from './BoardStore';
import {
  createShareLink,
  listShareLinks,
  redeemShareLink,
  revokeShareLink,
} from './shareLinks';
import { findTemplate, templateMoves, templateSummaries } from './templates';

const grantableRole = z.enum(GRANTABLE_ROLES);

const createLinkSchema = z.object({
  role: grantableRole,
  /** Omitted or null means the link never expires. */
  expiresInHours: z.number().int().positive().max(24 * 365).nullable().optional(),
});

const settingsSchema = z
  .object({
    visibility: z.enum(['private', 'link']).optional(),
    linkRole: grantableRole.optional(),
  })
  .refine((value) => value.visibility !== undefined || value.linkRole !== undefined, {
    message: 'nothing to change',
  });

const createBoardSchema = z.object({
  title: z.string().max(80).optional(),
  templateId: z.string().max(40).optional(),
  engine: z.enum(['raster', 'vector']).optional(),
});

const renameSchema = z.object({ title: renameRoomSchema });

type IOServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export type BoardRouteDeps = {
  db: Db;
  boards: BoardStore;
  roles: RoleResolver;
  auth: AuthDeps;
  io: IOServer;
  storage: ObjectStorage;
};

/** A board as the dashboard shows it. */
export type BoardCard = {
  id: string;
  title: string;
  role: Role;
  visibility: string;
  thumbnailUrl: string | null;
  lastActivityAt: number;
  starred: boolean;
};

/**
 * Sharing over HTTP: owners mint, list and revoke share links and change a
 * board's visibility; anyone with an identity redeems a link into a
 * membership. Only registered with a database, because memberships live
 * there; in memory mode the room URL is the only invitation.
 */
export const registerBoardRoutes = (app: Express, deps: BoardRouteDeps) => {
  const json = express.json({ limit: '4kb' });

  /** Identity, board id and role for an owner-only route; answers the error itself. */
  const ownerContext = async (
    req: Request,
    res: Response,
  ): Promise<{ identity: Identity; boardId: string } | null> => {
    const identity = await identityFromRequest(req, deps.auth);

    if (!identity) {
      res.status(401).json({ error: 'sign in or open a board first' });
      return null;
    }

    const boardId = roomIdSchema.safeParse(req.params.id);

    if (!boardId.success) {
      res.status(404).json({ error: 'no such board' });
      return null;
    }

    if (!(await deps.boards.ensureLoaded(boardId.data))) {
      res.status(404).json({ error: 'no such board' });
      return null;
    }

    const role = await deps.roles.roleFor(boardId.data, identity.userId);

    if (!canManage(role)) {
      res.status(403).json({ error: 'only the owner can do that' });
      return null;
    }

    return { identity, boardId: boardId.data };
  };

  /** Identity and role for any-member routes. */
  const memberContext = async (
    req: Request,
    res: Response,
  ): Promise<{ identity: Identity; boardId: string; role: Role } | null> => {
    const identity = await identityFromRequest(req, deps.auth);

    if (!identity) {
      res.status(401).json({ error: 'sign in or open a board first' });
      return null;
    }

    const boardId = roomIdSchema.safeParse(req.params.id);

    if (!boardId.success || !(await deps.boards.ensureLoaded(boardId.data))) {
      res.status(404).json({ error: 'no such board' });
      return null;
    }

    const role = await deps.roles.roleFor(boardId.data, identity.userId);

    if (!canView(role)) {
      res.status(403).json({ error: 'you do not have access to this board' });
      return null;
    }

    return { identity, boardId: boardId.data, role };
  };

  app.get('/api/templates', (_req, res) => {
    res.json(templateSummaries());
  });

  /** Every board the caller owns or is a member of, most recently active first. */
  app.get('/api/boards', async (req, res) => {
    const identity = await identityFromRequest(req, deps.auth);

    if (!identity) {
      res.status(401).json({ error: 'sign in or open a board first' });
      return;
    }

    const memberships = await deps.db
      .select({ boardId: boardMembers.boardId, role: boardMembers.role })
      .from(boardMembers)
      .where(eq(boardMembers.userId, identity.userId));
    const roleByBoard = new Map(memberships.map((row) => [row.boardId, row.role as Role]));

    const rows = await deps.db
      .select()
      .from(boards)
      .where(
        and(
          isNull(boards.deletedAt),
          or(
            eq(boards.ownerId, identity.userId),
            memberships.length
              ? inArray(
                  boards.id,
                  memberships.map((row) => row.boardId),
                )
              : eq(boards.ownerId, identity.userId),
          ),
        ),
      )
      .orderBy(desc(boards.lastActivityAt))
      .limit(100);

    const stars = new Set(
      (
        await deps.db
          .select({ boardId: boardStars.boardId })
          .from(boardStars)
          .where(eq(boardStars.userId, identity.userId))
      ).map((row) => row.boardId),
    );

    const cards: BoardCard[] = rows.map((row) => ({
      id: row.id,
      title: row.title,
      role: row.ownerId === identity.userId ? 'owner' : (roleByBoard.get(row.id) ?? 'viewer'),
      visibility: row.visibility,
      thumbnailUrl: row.thumbnailKey ? deps.storage.publicUrl(row.thumbnailKey) : null,
      lastActivityAt: row.lastActivityAt.getTime(),
      starred: stars.has(row.id),
    }));

    res.json({ boards: cards, identity });
  });

  /** A new board, optionally seeded from a template, owned by the caller. */
  app.post('/api/boards', json, async (req, res) => {
    const identity = await identityFromRequest(req, deps.auth);

    if (!identity) {
      res.status(401).json({ error: 'sign in or open a board first' });
      return;
    }

    const body = createBoardSchema.safeParse(req.body ?? {});

    if (!body.success) {
      res.status(400).json({ error: 'title must be at most 80 characters' });
      return;
    }

    const template = findTemplate(body.data.templateId);

    if (!template) {
      res.status(400).json({ error: 'unknown template' });
      return;
    }

    const title = body.data.title?.trim() || (template.id === 'blank' ? undefined : template.name);
    const engine = body.data.engine ?? 'raster';
    const roomId = await deps.boards.createDetached(
      identity.userId,
      identity.name ?? 'Anonymous',
      title,
      engine,
    );

    // Templates are raster moves; a vector board starts empty until Phase 4's
    // object templates arrive.
    if (engine === 'raster') {
      templateMoves(template).forEach((payload) => deps.boards.addMove(roomId, identity.userId, payload));
    }

    res.status(201).json({ id: roomId, title: deps.boards.get(roomId)?.title });
  });

  app.patch('/api/boards/:id', json, async (req, res) => {
    const context = await ownerContext(req, res);
    if (!context) return;

    const body = renameSchema.safeParse(req.body);

    if (!body.success) {
      res.status(400).json({ error: 'title must be 1 to 80 characters' });
      return;
    }

    deps.boards.rename(context.boardId, body.data.title);
    deps.io.to(context.boardId).emit('room_renamed', deps.boards.get(context.boardId)?.title ?? body.data.title);

    res.json({ id: context.boardId, title: deps.boards.get(context.boardId)?.title });
  });

  /** Soft delete: the row stays (for a future restore), the room is evicted, everyone is sent home. */
  app.delete('/api/boards/:id', async (req, res) => {
    const context = await ownerContext(req, res);
    if (!context) return;

    await deps.boards.flush();
    await deps.db
      .update(boards)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(boards.id, context.boardId));

    deps.io.to(context.boardId).emit('board_deleted');
    deps.io.in(context.boardId).socketsLeave(context.boardId);
    deps.boards.rooms.delete(context.boardId);
    deps.roles.invalidate(context.boardId);

    res.status(204).end();
  });

  /** A copy of a board the caller can see, owned by the caller. */
  app.post('/api/boards/:id/duplicate', async (req, res) => {
    const context = await memberContext(req, res);
    if (!context) return;

    const source = deps.boards.get(context.boardId);

    if (!source) {
      res.status(404).json({ error: 'no such board' });
      return;
    }

    const copyId = await deps.boards.createDetached(
      context.identity.userId,
      context.identity.name ?? 'Anonymous',
      `${source.title} (copy)`,
    );

    deps.boards.movesSince(context.boardId, 0).forEach((move) => {
      const { id, timestamp, seq, userId, meta, ...payload } = move;

      deps.boards.addMove(copyId, context.identity.userId, { ...payload, clientId: `${copyId}:${id}` });
    });

    res.status(201).json({ id: copyId, title: deps.boards.get(copyId)?.title });
  });

  app.post('/api/boards/:id/star', async (req, res) => {
    const context = await memberContext(req, res);
    if (!context) return;

    await deps.db
      .insert(boardStars)
      .values({ boardId: context.boardId, userId: context.identity.userId })
      .onConflictDoNothing();

    res.status(204).end();
  });

  app.delete('/api/boards/:id/star', async (req, res) => {
    const context = await memberContext(req, res);
    if (!context) return;

    await deps.db
      .delete(boardStars)
      .where(and(eq(boardStars.boardId, context.boardId), eq(boardStars.userId, context.identity.userId)));

    res.status(204).end();
  });

  app.get('/api/boards/:id/share-links', async (req, res) => {
    const context = await ownerContext(req, res);
    if (!context) return;

    res.json(await listShareLinks(deps.db, context.boardId));
  });

  app.post('/api/boards/:id/share-links', json, async (req, res) => {
    const context = await ownerContext(req, res);
    if (!context) return;

    const body = createLinkSchema.safeParse(req.body);

    if (!body.success) {
      res.status(400).json({ error: 'role must be editor, commenter or viewer' });
      return;
    }

    const link = await createShareLink(deps.db, {
      boardId: context.boardId,
      role: body.data.role,
      createdBy: context.identity.userId,
      expiresInHours: body.data.expiresInHours ?? undefined,
    });

    res.status(201).json({ ...link, url: `/join/${link.token}` });
  });

  app.delete('/api/boards/:id/share-links/:token', async (req, res) => {
    const context = await ownerContext(req, res);
    if (!context) return;

    const revoked = await revokeShareLink(deps.db, context.boardId, String(req.params.token));

    res.status(revoked ? 204 : 404).end();
  });

  app.patch('/api/boards/:id/settings', json, async (req, res) => {
    const context = await ownerContext(req, res);
    if (!context) return;

    const body = settingsSchema.safeParse(req.body);

    if (!body.success) {
      res.status(400).json({ error: 'visibility must be private or link; linkRole editor, commenter or viewer' });
      return;
    }

    await deps.db
      .update(boards)
      .set({ ...body.data, updatedAt: new Date() })
      .where(eq(boards.id, context.boardId));

    deps.roles.invalidate(context.boardId);

    res.json(body.data);
  });

  app.post('/api/join/:token', json, async (req, res) => {
    const identity = await identityFromRequest(req, deps.auth);

    if (!identity) {
      res.status(401).json({ error: 'open the app once first' });
      return;
    }

    const token = String(req.params.token);

    if (!/^[A-Za-z0-9_-]{16,64}$/u.test(token)) {
      res.status(404).json({ status: 'invalid' });
      return;
    }

    try {
      const result = await redeemShareLink(deps.db, deps.roles, token, {
        userId: identity.userId,
        name: identity.name,
      });

      if (result.status !== 'ok') {
        res.status(result.status === 'invalid' ? 404 : 410).json(result);
        return;
      }

      res.json(result);
    } catch (error) {
      logger.error({ err: error }, 'redeeming a share link failed');
      res.status(500).json({ status: 'error' });
    }
  });
};
