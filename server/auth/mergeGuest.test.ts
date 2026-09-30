import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPglite, type Database } from '../db/client';
import {
  boardMembers,
  boardMoves,
  boards,
  boardStars,
  chatMessages,
  users,
} from '../db/schema';
import { makeMove } from '../testing/fixtures';
import { mergeGuest } from './mergeGuest';

describe('mergeGuest', () => {
  let database: Database;
  const guest = randomUUID();
  const account = randomUUID();

  beforeAll(async () => {
    database = await createPglite();
    const { db } = database;

    await db.insert(users).values([
      { id: guest, name: 'Guest', isGuest: true },
      { id: account, name: 'Alice', email: 'alice@example.com', isGuest: false },
    ]);
    await db.insert(boards).values([
      { id: 'owned000', title: 'Owned by guest', ownerId: guest },
      { id: 'shared00', title: 'Both members', ownerId: account },
      { id: 'viewer00', title: 'Guest views', ownerId: account },
    ]);
    await db.insert(boardMembers).values([
      { boardId: 'owned000', userId: guest, role: 'owner' },
      { boardId: 'shared00', userId: guest, role: 'editor' },
      { boardId: 'shared00', userId: account, role: 'viewer' },
      { boardId: 'viewer00', userId: guest, role: 'viewer' },
      { boardId: 'viewer00', userId: account, role: 'owner' },
    ]);
    await db.insert(boardStars).values([
      { boardId: 'owned000', userId: guest },
      { boardId: 'shared00', userId: guest },
      { boardId: 'shared00', userId: account },
    ]);

    const move = makeMove({ id: 'g-move', seq: 1, userId: guest });
    await db.insert(boardMoves).values({
      moveId: move.id,
      boardId: 'owned000',
      seq: 1,
      userId: guest,
      clientId: move.clientId,
      payload: move,
    });
    await db.insert(chatMessages).values({
      id: 'c1',
      boardId: 'owned000',
      userId: guest,
      name: 'Guest',
      body: 'hi',
    });
  }, 60_000);

  afterAll(async () => {
    await database.close();
  });

  it('moves ownership, memberships (higher role wins), stars, authorship, and deletes the guest', async () => {
    await mergeGuest(database.db, guest, account);

    const { db } = database;

    expect((await db.select().from(boards).where(eq(boards.id, 'owned000')))[0].ownerId).toBe(account);

    const memberships = await db.select().from(boardMembers).where(eq(boardMembers.userId, account));
    const byBoard = Object.fromEntries(memberships.map((m) => [m.boardId, m.role]));

    expect(byBoard).toEqual({ owned000: 'owner', shared00: 'editor', viewer00: 'owner' });
    expect(await db.select().from(boardMembers).where(eq(boardMembers.userId, guest))).toEqual([]);

    const stars = await db.select().from(boardStars).where(eq(boardStars.userId, account));
    expect(stars.map((s) => s.boardId).sort()).toEqual(['owned000', 'shared00']);

    const [move] = await db.select().from(boardMoves).where(eq(boardMoves.moveId, 'g-move'));
    expect(move.userId).toBe(account);
    expect(move.payload.userId).toBe(account);

    const [chat] = await db.select().from(chatMessages).where(eq(chatMessages.id, 'c1'));
    expect(chat.userId).toBe(account);

    expect(await db.select().from(users).where(eq(users.id, guest))).toEqual([]);
  });

  it('is a no-op when run again, for a missing guest, or for a non-guest', async () => {
    await mergeGuest(database.db, guest, account);
    await mergeGuest(database.db, randomUUID(), account);

    const other = randomUUID();
    await database.db.insert(users).values({ id: other, email: 'o@example.com', isGuest: false });
    await database.db.insert(boards).values({ id: 'other000', title: 'Other', ownerId: other });

    await mergeGuest(database.db, other, account);

    expect((await database.db.select().from(boards).where(eq(boards.id, 'other000')))[0].ownerId).toBe(other);
    expect(await database.db.select().from(users).where(eq(users.id, other))).toHaveLength(1);
  });
});
