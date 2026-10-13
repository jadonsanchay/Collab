import { randomUUID } from 'crypto';
import { ExpressAuth, type ExpressAuthConfig, getSession } from '@auth/express';
import { parseCookie } from 'cookie';
import { eq, or } from 'drizzle-orm';
import express, { type Express, type Request } from 'express';

import { registerSchema } from '@/common/schemas/auth';
import { userIdSchema } from '@/common/schemas/user';

import type { Config } from '../config';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { logger } from '../logger';
import { AUTH_BASE_PATH } from './authConfig';
import { GUEST_COOKIE, guestCookieOptions, signGuest, verifyGuest } from './guestCookie';
import { hashPassword } from './password';
import { type Identity, resolveSession } from './session';

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
 * The same resolution from a raw `Cookie` header, for WebSocket upgrades
 * that never pass through Express: the session JWT first, then the guest
 * cookie.
 */
export const identityFromCookieHeader = async (
  cookieHeader: string | undefined,
  deps: AuthDeps,
): Promise<Identity | null> => {
  if (deps.authConfig && deps.config.AUTH_SECRET) {
    const session = await resolveSession(cookieHeader, deps.config.AUTH_SECRET);
    if (session) return session;
  }

  const guestId = verifyGuest(parseCookie(cookieHeader ?? '')[GUEST_COOKIE], deps.guestSecret);

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

  /**
   * Creates a password account. Sign-in itself goes through Auth.js's
   * `password` provider afterwards, so this only has to store the row.
   */
  app.post('/api/account/register', express.json({ limit: '4kb' }), async (req, res) => {
    if (!deps.authConfig || !deps.db) {
      res.status(404).json({ error: 'sign-in is not available on this server' });
      return;
    }

    const parsed = registerSchema.safeParse(req.body);

    if (!parsed.success) {
      const [issue] = parsed.error.issues;
      res.status(400).json({ error: `${issue.path.join('.')}: ${issue.message}`, field: issue.path[0] });
      return;
    }

    const { name, username, email, password } = parsed.data;
    const [taken] = await deps.db
      .select({ email: users.email, username: users.username })
      .from(users)
      .where(or(eq(users.email, email), eq(users.username, username)));

    if (taken) {
      const field = taken.email === email ? 'email' : 'username';
      res.status(409).json({ error: `that ${field} is already registered`, field });
      return;
    }

    const id = randomUUID();

    await deps.db.insert(users).values({
      id,
      name,
      username,
      email,
      passwordHash: await hashPassword(password),
      isGuest: false,
    });

    res.status(201).json({ userId: id, name, username, email });
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
