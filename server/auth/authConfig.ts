import { randomUUID } from 'crypto';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import type { ExpressAuthConfig } from '@auth/express';
import Credentials from '@auth/express/providers/credentials';
import GitHub from '@auth/express/providers/github';
import Google from '@auth/express/providers/google';
import { eq, or } from 'drizzle-orm';

import { loginSchema } from '@/common/schemas/auth';

import type { Config } from '../config';
import type { Db } from '../db/client';
import { accounts, sessions, users, verificationTokens } from '../db/schema';
import { logger } from '../logger';
import { verifyPassword } from './password';

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

  const providers: ExpressAuthConfig['providers'] = [
    // Email or username plus password, against accounts made by
    // POST /api/account/register. Always present when sign-in exists.
    Credentials({
      id: 'password',
      name: 'Email or username and password',
      credentials: {
        identifier: { label: 'Email or username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      authorize: async (credentials) => {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { identifier, password } = parsed.data;
        const [account] = await db
          .select()
          .from(users)
          .where(or(eq(users.email, identifier), eq(users.username, identifier)));

        if (!account || !(await verifyPassword(password, account.passwordHash))) return null;

        return { id: account.id, email: account.email, name: account.name, image: account.image };
      },
    }),
  ];

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

  logger.info({ providers: providers.length }, 'sign-in enabled');

  return {
    secret: config.AUTH_SECRET,
    trustHost: true,
    basePath: AUTH_BASE_PATH,
    // Our own pages, not Auth.js's generated ones. A failed password lands
    // back on /login with `?error=CredentialsSignin`.
    pages: { signIn: '/login', error: '/login' },
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
        // On sign-in the handle rides in the token, so neither the socket
        // handshake nor the HTTP routes need a database round trip for it.
        if (user?.id) {
          const [row] = await db.select({ username: users.username }).from(users).where(eq(users.id, user.id));

          return { ...token, sub: user.id, username: row?.username ?? null };
        }

        return token;
      },
      session: async ({ session, token }) => {
        if (token.sub) {
          return { ...session, user: { ...session.user, id: token.sub, username: token.username ?? null } };
        }

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
