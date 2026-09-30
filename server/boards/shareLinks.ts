import { randomBytes } from 'crypto';
import { and, eq, gt, isNull, or } from 'drizzle-orm';

import { type GrantableRole, ROLE_RANK, type Role } from '@/common/constants/roles';

import type { RoleResolver } from '../auth/roles';
import type { Db } from '../db/client';
import { boardMembers, shareLinks, users } from '../db/schema';

export type ShareLink = {
  token: string;
  boardId: string;
  role: GrantableRole;
  expiresAt: number | null;
  createdAt: number;
};

const toShareLink = (row: typeof shareLinks.$inferSelect): ShareLink => ({
  token: row.token,
  boardId: row.boardId,
  role: row.role as GrantableRole,
  expiresAt: row.expiresAt ? row.expiresAt.getTime() : null,
  createdAt: row.createdAt.getTime(),
});

/**
 * Invitations by URL. A link carries a role and an optional expiry; whoever
 * redeems it becomes a member with that role (never downgrading an existing
 * membership). Revoking a link does not remove the members it created.
 */
export const createShareLink = async (
  db: Db,
  input: { boardId: string; role: GrantableRole; createdBy: string; expiresInHours?: number },
): Promise<ShareLink> => {
  const token = randomBytes(16).toString('base64url');
  const expiresAt = input.expiresInHours
    ? new Date(Date.now() + input.expiresInHours * 3_600_000)
    : null;

  const [row] = await db
    .insert(shareLinks)
    .values({ token, boardId: input.boardId, role: input.role, createdBy: input.createdBy, expiresAt })
    .returning();

  return toShareLink(row);
};

/** Links that can still be redeemed, newest first. */
export const listShareLinks = async (db: Db, boardId: string): Promise<ShareLink[]> => {
  const rows = await db
    .select()
    .from(shareLinks)
    .where(
      and(
        eq(shareLinks.boardId, boardId),
        isNull(shareLinks.revokedAt),
        or(isNull(shareLinks.expiresAt), gt(shareLinks.expiresAt, new Date())),
      ),
    );

  return rows.map(toShareLink).sort((a, b) => b.createdAt - a.createdAt);
};

export const revokeShareLink = async (db: Db, boardId: string, token: string): Promise<boolean> => {
  const rows = await db
    .update(shareLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(shareLinks.token, token), eq(shareLinks.boardId, boardId), isNull(shareLinks.revokedAt)))
    .returning();

  return rows.length > 0;
};

export type RedeemResult =
  | { status: 'ok'; boardId: string; role: Role }
  | { status: 'invalid' | 'expired' | 'revoked' };

/** Turns a link into a membership for `user`. */
export const redeemShareLink = async (
  db: Db,
  roles: RoleResolver,
  token: string,
  user: { userId: string; name: string | null },
): Promise<RedeemResult> => {
  const [link] = await db.select().from(shareLinks).where(eq(shareLinks.token, token));

  if (!link) return { status: 'invalid' };
  if (link.revokedAt) return { status: 'revoked' };
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) return { status: 'expired' };

  const role = link.role as Role;

  await db.transaction(async (tx) => {
    await tx
      .insert(users)
      .values({ id: user.userId, name: user.name, isGuest: true })
      .onConflictDoNothing();

    const [existing] = await tx
      .select({ role: boardMembers.role })
      .from(boardMembers)
      .where(and(eq(boardMembers.boardId, link.boardId), eq(boardMembers.userId, user.userId)));

    if (!existing) {
      await tx.insert(boardMembers).values({ boardId: link.boardId, userId: user.userId, role });
    } else if ((ROLE_RANK[existing.role as Role] ?? 0) < ROLE_RANK[role]) {
      await tx
        .update(boardMembers)
        .set({ role })
        .where(and(eq(boardMembers.boardId, link.boardId), eq(boardMembers.userId, user.userId)));
    }
  });

  roles.invalidate(link.boardId, user.userId);

  const [membership] = await db
    .select({ role: boardMembers.role })
    .from(boardMembers)
    .where(and(eq(boardMembers.boardId, link.boardId), eq(boardMembers.userId, user.userId)));

  return { status: 'ok', boardId: link.boardId, role: (membership?.role as Role) ?? role };
};
