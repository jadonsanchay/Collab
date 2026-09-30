import { and, eq, ne, sql } from 'drizzle-orm';

import type { Db } from '../db/client';
import {
  boardMembers,
  boardMoves,
  boardOps,
  boards,
  boardStars,
  chatMessages,
  users,
} from '../db/schema';
import { logger } from '../logger';

const ROLE_RANK: Record<string, number> = { viewer: 1, commenter: 2, editor: 3, owner: 4 };

/**
 * A guest signs in: everything the guest id owned, joined, starred, drew or
 * said becomes the account's. Idempotent and in one transaction, so it can
 * run on every connection that presents both ids without doing harm twice.
 * Where both ids are members of a board the higher role wins.
 */
export const mergeGuest = async (db: Db, guestId: string, accountId: string) => {
  if (!guestId || !accountId || guestId === accountId) return;

  const [guest] = await db.select({ id: users.id, isGuest: users.isGuest }).from(users).where(eq(users.id, guestId));

  // Nothing to merge, or the "guest" is another real account: leave it.
  if (!guest || !guest.isGuest) return;

  await db.transaction(async (tx) => {
    await tx.update(boards).set({ ownerId: accountId }).where(eq(boards.ownerId, guestId));

    const memberships = await tx
      .select()
      .from(boardMembers)
      .where(eq(boardMembers.userId, guestId));

    await memberships.reduce<Promise<unknown>>(async (previous, membership) => {
      await previous;

      const [existing] = await tx
        .select()
        .from(boardMembers)
        .where(and(eq(boardMembers.boardId, membership.boardId), eq(boardMembers.userId, accountId)));

      if (!existing) {
        await tx
          .insert(boardMembers)
          .values({ boardId: membership.boardId, userId: accountId, role: membership.role });
      } else if ((ROLE_RANK[membership.role] ?? 0) > (ROLE_RANK[existing.role] ?? 0)) {
        await tx
          .update(boardMembers)
          .set({ role: membership.role })
          .where(and(eq(boardMembers.boardId, membership.boardId), eq(boardMembers.userId, accountId)));
      }
    }, Promise.resolve());

    await tx.delete(boardMembers).where(eq(boardMembers.userId, guestId));

    const stars = await tx.select().from(boardStars).where(eq(boardStars.userId, guestId));

    await Promise.all(
      stars.map((star) =>
        tx.insert(boardStars).values({ boardId: star.boardId, userId: accountId }).onConflictDoNothing(),
      ),
    );
    await tx.delete(boardStars).where(eq(boardStars.userId, guestId));

    // Authorship: move payloads carry userId inside the JSON as well.
    await tx
      .update(boardMoves)
      .set({
        userId: accountId,
        payload: sql`jsonb_set(${boardMoves.payload}, '{userId}', to_jsonb(${accountId}::text))`,
      })
      .where(eq(boardMoves.userId, guestId));
    await tx.update(boardOps).set({ userId: accountId }).where(eq(boardOps.userId, guestId));
    await tx.update(chatMessages).set({ userId: accountId }).where(eq(chatMessages.userId, guestId));

    await tx.delete(users).where(and(eq(users.id, guestId), ne(users.id, accountId)));
  });

  logger.info({ guestId, accountId }, 'merged a guest into an account');
};
