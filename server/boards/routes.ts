import { eq } from 'drizzle-orm';
import express, { type Express, type Request, type Response } from 'express';
import { z } from 'zod';

import { canManage, GRANTABLE_ROLES } from '@/common/constants/roles';
import { roomIdSchema } from '@/common/schemas/user';

import type { RoleResolver } from '../auth/roles';
import { type AuthDeps, identityFromRequest } from '../auth/routes';
import type { Identity } from '../auth/session';
import type { Db } from '../db/client';
import { boards } from '../db/schema';
import { logger } from '../logger';
import type { BoardStore } from './BoardStore';
import {
  createShareLink,
  listShareLinks,
  redeemShareLink,
  revokeShareLink,
} from './shareLinks';

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

export type BoardRouteDeps = {
  db: Db;
  boards: BoardStore;
  roles: RoleResolver;
  auth: AuthDeps;
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
