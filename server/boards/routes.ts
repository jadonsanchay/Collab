import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import express, { type Express, type Request, type Response } from 'express';
import type { Server } from 'socket.io';
import * as Y from 'yjs';
import { z } from 'zod';

import { CANVAS_SIZE } from '@/common/constants/canvasSize';
import { canManage, canView, GRANTABLE_ROLES, type Role } from '@/common/constants/roles';
import { renameRoomSchema } from '@/common/schemas/events';
import { roomIdSchema } from '@/common/schemas/user';
import type {
  BoardEngine,
  ClientToServerEvents,
  ServerToClientEvents,
} from '@/common/types/global';
import { createObject, readAll } from '@/common/vector/doc';
import { topZ } from '@/common/vector/order';
import type { BoardObject } from '@/common/vector/types';

import type { RoleResolver } from '../auth/roles';
import { type AuthDeps, identityFromRequest } from '../auth/routes';
import type { Identity } from '../auth/session';
import type { Db } from '../db/client';
import { boardMembers, boards, boardStars } from '../db/schema';
import { logger } from '../logger';
import { createNodeImageLoader } from '../render/nodeLoader';
import { encodePng, renderBoard } from '../render/renderBoard';
import type { SocketData } from '../socket/identity';
import type { ObjectStorage } from '../storage';
import type { DbVectorPersistence } from '../vector/dbPersistence';
import type { VectorDocStore } from '../vector/docStore';
import { movesToObjects, planUpgrade } from '../vector/fromMoves';
import type { BoardStore } from './BoardStore';
import {
  createShareLink,
  listShareLinks,
  redeemShareLink,
  revokeShareLink,
} from './shareLinks';
import { seedTemplate } from './seedTemplate';
import { findTemplate } from './templates';

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
  vectorDocs: VectorDocStore;
  /** The update log behind vector documents, which Rewind replays. */
  vectorPersistence: DbVectorPersistence;
  defaultEngine: BoardEngine;
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
  const imageLoader = createNodeImageLoader(deps.storage);

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
    const engine = body.data.engine ?? deps.defaultEngine;
    const roomId = await deps.boards.createDetached(
      identity.userId,
      identity.name ?? 'Anonymous',
      title,
      engine,
    );

    await seedTemplate({
      boards: deps.boards,
      vectorDocs: deps.vectorDocs,
      roomId,
      userId: identity.userId,
      template,
      engine,
    });

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
      source.engine ?? 'raster',
    );

    if (source.engine === 'vector') {
      // The document's current state, as one update, into the copy's document.
      const [from, to] = await Promise.all([
        deps.vectorDocs.open(context.boardId),
        deps.vectorDocs.open(copyId),
      ]);

      Y.applyUpdate(to.doc, Y.encodeStateAsUpdate(from.doc), { userId: context.identity.userId });
      deps.vectorDocs.release(context.boardId);
      deps.vectorDocs.release(copyId);
    }

    deps.boards.movesSince(context.boardId, 0).forEach((move) => {
      const { id, timestamp, seq, userId, meta, ...payload } = move;

      deps.boards.addMove(copyId, context.identity.userId, { ...payload, clientId: `${copyId}:${id}` });
    });

    res.status(201).json({ id: copyId, title: deps.boards.get(copyId)?.title });
  });

  /**
   * "Convert to objects": a raster board becomes a vector one. Owners only,
   * one way. Moves become objects when the pixel eraser was never used;
   * otherwise the erased picture is flattened to one locked image and
   * later text and images stay editable (see `planUpgrade`). Everyone in
   * the room remounts the board on `board_engine`.
   */
  app.post('/api/boards/:id/upgrade', async (req, res) => {
    const context = await ownerContext(req, res);
    if (!context) return;

    const room = deps.boards.get(context.boardId);

    if (!room) {
      res.status(404).json({ error: 'no such board' });
      return;
    }

    if (room.engine === 'vector') {
      res.status(409).json({ error: 'already an objects board' });
      return;
    }

    const ownerId = context.identity.userId;
    const plan = planUpgrade(deps.boards.movesSince(context.boardId, 0));
    const entry = await deps.vectorDocs.open(context.boardId);

    try {
      let objects: BoardObject[];
      const firstZ = topZ(readAll(entry.doc));

      if (plan.strategy === 'image') {
        const canvas = await renderBoard(plan.flattened, { loader: imageLoader, background: null });
        const key = `boards/${context.boardId}/legacy/${room.seq}.png`;

        await deps.storage.put(key, await encodePng(canvas), 'image/png');

        const legacy: BoardObject = {
          id: `legacy:${room.seq}`,
          type: 'image',
          x: 0,
          y: 0,
          w: CANVAS_SIZE.width,
          h: CANVAS_SIZE.height,
          rotation: 0,
          z: firstZ,
          createdBy: ownerId,
          createdAt: Date.now(),
          locked: true,
          url: deps.storage.publicUrl(key),
          naturalW: canvas.width,
          naturalH: canvas.height,
          meta: { legacy: true },
        };

        objects = [legacy, ...movesToObjects(plan.after, ownerId, { firstZ: topZ([legacy]) })];
      } else {
        objects = movesToObjects(plan.moves, ownerId, { firstZ });
      }

      entry.doc.transact(() => {
        objects.forEach((object) => createObject(entry.doc, object));
      }, { userId: ownerId });

      deps.boards.setEngine(context.boardId, 'vector');
      deps.io.to(context.boardId).emit('board_engine', 'vector');

      logger.info(
        { boardId: context.boardId, strategy: plan.strategy, objects: objects.length },
        'board upgraded to objects',
      );

      res.json({ engine: 'vector', strategy: plan.strategy, objects: objects.length });
    } catch (error) {
      logger.error({ err: error, boardId: context.boardId }, 'upgrade failed');
      res.status(500).json({ error: 'the board could not be converted' });
    } finally {
      deps.vectorDocs.release(context.boardId);
    }
  });

  /**
   * The vector document's update log, oldest first, for Rewind: applying
   * updates 1..k to an empty document gives the board as it was at k.
   * Base64 because JSON has no bytes.
   */
  app.get('/api/boards/:id/doc-updates', async (req, res) => {
    const context = await memberContext(req, res);
    if (!context) return;

    if (deps.boards.get(context.boardId)?.engine !== 'vector') {
      res.status(404).json({ error: 'not an objects board' });
      return;
    }

    const rows = await deps.vectorPersistence.updatesUpTo(context.boardId, Number.MAX_SAFE_INTEGER);

    res.json({
      latestSeq: rows.length ? Number(rows[rows.length - 1].seq) : 0,
      updates: rows.map((row) => ({
        seq: Number(row.seq),
        userId: row.userId,
        update: Buffer.from(row.update).toString('base64'),
      })),
    });
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
