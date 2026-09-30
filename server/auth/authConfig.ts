import { randomUUID } from 'crypto';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import type { ExpressAuthConfig } from '@auth/express';
import Credentials from '@auth/express/providers/credentials';
import GitHub from '@auth/express/providers/github';
import Google from '@auth/express/providers/google';
import { eq } from 'drizzle-orm';

import type { Config } from '../config';
import type { Db } from '../db/client';
import { accounts, sessions, users, verificationTokens } from '../db/schema';
import { logger } from '../logger';

export const AUTH_BASE_PATH = '/api/auth';

/**
 * Auth.js on Express, sharing the server's database. Sessions are JWTs in a
 * cookie: the socket handshake can verify one with the secret alone, and the
 * dev-login provider (which cannot use database sessions) works the same
 * way as OAuth. The adapter still persists users and accounts.
 *
 * Null when sign-in is not configured, in which case only guests exist.
 */
export const buildAuthConfig = (config: Config, db: Db): ExpressAuthConfig | null => {
  if (!config.AUTH_SECRET) return null;

  const providers: ExpressAuthConfig['providers'] = [];

  if (config.AUTH_GOOGLE_ID && config.AUTH_GOOGLE_SECRET) {
    providers.push(
      Google({ clientId: config.AUTH_GOOGLE_ID, clientSecret: config.AUTH_GOOGLE_SECRET }),
    );
  }

  if (config.AUTH_GITHUB_ID && config.AUTH_GITHUB_SECRET) {
    providers.push(
      GitHub({ clientId: config.AUTH_GITHUB_ID, clientSecret: config.AUTH_GITHUB_SECRET }),
    );
  }

  if (config.AUTH_DEV_LOGIN && config.NODE_ENV !== 'production') {
    providers.push(
      Credentials({
        id: 'dev',
        name: 'Dev login (no password)',
        credentials: {
          email: { label: 'Email', type: 'email' },
          name: { label: 'Name', type: 'text' },
        },
        authorize: async (credentials) => {
          const email = String(credentials?.email ?? '')
            .trim()
            .toLowerCase();

          if (!email.includes('@')) return null;

          const name = String(credentials?.name ?? '').trim() || email.split('@')[0];

          const [existing] = await db.select().from(users).where(eq(users.email, email));

          if (existing) return { id: existing.id, email, name: existing.name ?? name };

          const id = randomUUID();
          await db.insert(users).values({ id, email, name, isGuest: false });

          return { id, email, name };
        },
      }),
    );
  }

  if (!providers.length) {
    logger.info('AUTH_SECRET is set but no provider is configured; sign-in disabled');
    return null;
  }

  return {
    secret: config.AUTH_SECRET,
    trustHost: true,
    basePath: AUTH_BASE_PATH,
    adapter: DrizzleAdapter(db as unknown as Parameters<typeof DrizzleAdapter>[0], {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: sessions,
      verificationTokensTable: verificationTokens,
    }),
    session: { strategy: 'jwt' },
    providers,
    callbacks: {
      jwt: async ({ token, user }) => {
        if (user?.id) return { ...token, sub: user.id };

        return token;
      },
      session: async ({ session, token }) => {
        if (token.sub) return { ...session, user: { ...session.user, id: token.sub } };

        return session;
      },
    },
    events: {
      // Rows the adapter creates start as guests by column default; a signed-in
      // user is not one.
      createUser: async ({ user }) => {
        if (user.id) await db.update(users).set({ isGuest: false }).where(eq(users.id, user.id));
      },
    },
  };
};
