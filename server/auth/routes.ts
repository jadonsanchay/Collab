import { ExpressAuth, type ExpressAuthConfig, getSession } from '@auth/express';
import { parseCookie } from 'cookie';
import express, { type Express, type Request } from 'express';

import { userIdSchema } from '@/common/schemas/user';

import type { Config } from '../config';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { logger } from '../logger';
import { AUTH_BASE_PATH } from './authConfig';
import { GUEST_COOKIE, guestCookieOptions, signGuest, verifyGuest } from './guestCookie';
import type { Identity } from './session';

export type AuthDeps = {
  config: Config;
  /** Null when sign-in is not configured. */
  authConfig: ExpressAuthConfig | null;
  db: Db | null;
  guestSecret: string;
};

/**
 * Who an HTTP request belongs to: the Auth.js session if there is one, else
 * the signed guest cookie, else nobody.
 */
export const identityFromRequest = async (req: Request, deps: AuthDeps): Promise<Identity | null> => {
  if (deps.authConfig) {
    const session = await getSession(req, deps.authConfig);

    if (session?.user?.id) {
      return {
        userId: session.user.id,
        isGuest: false,
        name: session.user.name ?? null,
        email: session.user.email ?? null,
        image: session.user.image ?? null,
      };
    }
  }

  const guestId = verifyGuest(parseCookie(req.headers.cookie ?? '')[GUEST_COOKIE], deps.guestSecret);

  return guestId ? { userId: guestId, isGuest: true, name: null, email: null, image: null } : null;
};

/**
 * `/api/auth/*` is Auth.js. `/api/me` answers who the caller is, and
 * `POST /api/me/guest` lets the browser mirror its stable id into the signed
 * guest cookie so pages and API routes know the guest too.
 */
export const registerAuthRoutes = (app: Express, deps: AuthDeps) => {
  if (deps.authConfig) {
    app.set('trust proxy', true);
    app.use(`${AUTH_BASE_PATH}/*`, ExpressAuth(deps.authConfig));
  }

  app.get('/api/me', async (req, res) => {
    res.json(await identityFromRequest(req, deps));
  });

  app.post('/api/me/guest', express.json({ limit: '1kb' }), async (req, res) => {
    const current = await identityFromRequest(req, deps);

    // A signed-in user stays signed in; the guest id is merged elsewhere.
    if (current && !current.isGuest) {
      res.json(current);
      return;
    }

    const parsed = userIdSchema.safeParse((req.body as { userId?: unknown } | undefined)?.userId);

    if (!parsed.success) {
      res.status(400).json({ error: 'userId must be a uuid' });
      return;
    }

    if (deps.db) {
      try {
        await deps.db.insert(users).values({ id: parsed.data, isGuest: true }).onConflictDoNothing();
      } catch (error) {
        logger.warn({ err: error }, 'could not record a guest user');
      }
    }

    res.cookie(
      GUEST_COOKIE,
      signGuest(parsed.data, deps.guestSecret),
      guestCookieOptions(deps.config.NODE_ENV === 'production'),
    );
    res.json({ userId: parsed.data, isGuest: true, name: null, email: null, image: null });
  });
};
