import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPglite, type Database } from '../db/client';
import { boardMembers, boardOps, boards, users } from '../db/schema';
import { makeMove } from '../testing/fixtures';
import { DbPersistence } from './dbPersistence';

describe('DbPersistence', () => {
  let database: Database;
  let persistence: DbPersistence;
  const alice = randomUUID();

  beforeAll(async () => {
    database = await createPglite();
    persistence = new DbPersistence(database, { flushMs: 5, flushSize: 3 });
  }, 60_000);

  afterAll(async () => {
    await persistence.close();
  });

  it('creates the board with its owner as a guest user and an owner membership', async () => {
    await persistence.createRoom('room0001', { title: 'Retro', ownerId: alice, ownerName: 'Alice' });

    const [owner] = await database.db.select().from(users).where(eq(users.id, alice));
    const [board] = await database.db.select().from(boards).where(eq(boards.id, 'room0001'));
    const members = await database.db
      .select()
      .from(boardMembers)
      .where(eq(boardMembers.boardId, 'room0001'));

    expect(owner).toMatchObject({ name: 'Alice', isGuest: true });
    expect(board).toMatchObject({ title: 'Retro', ownerId: alice });
    expect(members).toEqual([expect.objectContaining({ userId: alice, role: 'owner' })]);

    // Creating twice is harmless.
    await persistence.createRoom('room0001', { title: 'Retro', ownerId: alice, ownerName: 'Alice' });
  });

  it('flushes buffered moves and loads them back in sequence order', async () => {
    const moves = [3, 1, 2].map((seq) => makeMove({ id: `m${seq}`, seq, userId: alice }));

    moves.forEach((move) => persistence.appendMove('room0001', move));
    await persistence.flush();

    const loaded = await persistence.loadRoom('room0001');

    expect(loaded?.moves.map((move) => move.id)).toEqual(['m1', 'm2', 'm3']);
    expect(loaded?.seq).toBe(3);
    expect(loaded?.title).toBe('Retro');
    expect(loaded?.ownerId).toBe(alice);
  });

  it('applies a move and its undo from the same batch in order, and keeps the history', async () => {
    persistence.appendMove('room0001', makeMove({ id: 'm4', seq: 4, userId: alice }));
    persistence.removeMoves('room0001', ['m4'], 'undo');
    await persistence.flush();

    const loaded = await persistence.loadRoom('room0001');

    expect(loaded?.moves.map((move) => move.id)).toEqual(['m1', 'm2', 'm3']);
    // The sequence still advances past the undone move.
    expect(loaded?.seq).toBe(4);

    const ops = await database.db
      .select({ kind: boardOps.kind, moveId: boardOps.moveId })
      .from(boardOps)
      .where(eq(boardOps.boardId, 'room0001'));

    expect(ops).toContainEqual({ kind: 'undo', moveId: 'm4' });
    expect(ops.filter((op) => op.kind === 'move')).toHaveLength(4);
  });

  it('flushes on its own once enough is waiting, or after the interval', async () => {
    persistence.appendMove('room0001', makeMove({ id: 'm5', seq: 5, userId: alice }));
    persistence.appendMove('room0001', makeMove({ id: 'm6', seq: 6, userId: alice }));
    persistence.appendMove('room0001', makeMove({ id: 'm7', seq: 7, userId: alice }));

    // flushSize is 3: no explicit flush.
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });

    expect((await persistence.loadRoom('room0001'))?.moves).toHaveLength(6);

    persistence.appendChat('room0001', {
      id: 'c1',
      userId: alice,
      name: 'Alice',
      body: 'first',
      createdAt: 1000,
    });

    await new Promise((resolve) => {
      setTimeout(resolve, 60);
    });

    expect((await persistence.loadRoom('room0001'))?.chat).toEqual([
      { id: 'c1', userId: alice, name: 'Alice', body: 'first', createdAt: 1000 },
    ]);
  });

  it('records renames and bulk removals', async () => {
    persistence.renameRoom('room0001', 'Sprint retro');
    persistence.removeMoves('room0001', ['m5', 'm6', 'nope'], 'remove');
    await persistence.flush();

    const loaded = await persistence.loadRoom('room0001');

    expect(loaded?.title).toBe('Sprint retro');
    expect(loaded?.moves.map((move) => move.id)).toEqual(['m1', 'm2', 'm3', 'm7']);
  });

  it('answers null for an unknown or deleted board', async () => {
    expect(await persistence.loadRoom('missing1')).toBeNull();

    await database.db
      .update(boards)
      .set({ deletedAt: new Date() })
      .where(eq(boards.id, 'room0001'));

    expect(await persistence.loadRoom('room0001')).toBeNull();

    await database.db.update(boards).set({ deletedAt: null }).where(eq(boards.id, 'room0001'));
  });

  it('drops a batch that keeps failing without breaking later ones', async () => {
    // A move for a board that does not exist violates the foreign key.
    const flaky = new DbPersistence(database, { flushMs: 5, maxRetries: 1 });

    flaky.appendMove('ghost001', makeMove({ id: 'g1', seq: 1, userId: alice }));
    await flaky.flush();

    flaky.appendMove('room0001', makeMove({ id: 'm8', seq: 8, userId: alice }));
    await flaky.flush();

    expect((await flaky.loadRoom('room0001'))?.moves.map((move) => move.id)).toContain('m8');
  });
});
