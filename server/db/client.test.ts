import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { makeMove } from '../testing/fixtures';
import { createPglite, type Database } from './client';
import { boardMoves, boards, chatMessages, toChatMessage, users } from './schema';

/**
 * The migrations and the schema, against the embedded engine in memory:
 * the same SQL that hosted Postgres runs, without a daemon.
 */
describe('database client (pglite)', () => {
  let database: Database;

  beforeAll(async () => {
    database = await createPglite();
  }, 60_000);

  afterAll(async () => {
    await database.close();
  });

  it('applies every migration and creates the tables', async () => {
    const result = await database.db.execute<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );

    const names = result.rows.map((row) => row.table_name);

    expect(names).toEqual(
      expect.arrayContaining([
        'users',
        'accounts',
        'sessions',
        'verification_tokens',
        'boards',
        'board_members',
        'board_stars',
        'board_moves',
        'board_ops',
        'board_snapshots',
        'chat_messages',
        'share_links',
        'ai_jobs',
      ]),
    );
  });

  it('round-trips a board with moves and chat through the schema', async () => {
    const { db } = database;
    const move = makeMove({ id: 'move-1', seq: 1, userId: 'user-1' });

    await db.insert(users).values({ id: 'user-1', name: 'Alice', isGuest: true });
    await db.insert(boards).values({ id: 'abcdefgh', title: 'Round trip', ownerId: 'user-1' });
    await db.insert(boardMoves).values({
      moveId: move.id,
      boardId: 'abcdefgh',
      seq: move.seq,
      userId: move.userId,
      clientId: move.clientId,
      payload: move,
    });
    await db.insert(chatMessages).values({
      id: 'chat-1',
      boardId: 'abcdefgh',
      userId: 'user-1',
      name: 'Alice',
      body: 'hello',
    });

    const [board] = await db.select().from(boards).where(eq(boards.id, 'abcdefgh'));
    const moves = await db.select().from(boardMoves).where(eq(boardMoves.boardId, 'abcdefgh'));
    const [chat] = await db.select().from(chatMessages).where(eq(chatMessages.boardId, 'abcdefgh'));

    expect(board.visibility).toBe('link');
    expect(board.linkRole).toBe('editor');
    expect(board.engine).toBe('raster');
    expect(moves).toHaveLength(1);
    expect(moves[0].payload).toEqual(move);
    expect(toChatMessage(chat)).toMatchObject({ id: 'chat-1', name: 'Alice', body: 'hello' });
    expect(typeof toChatMessage(chat).createdAt).toBe('number');
  });

  it('cascades a board delete to its moves', async () => {
    const { db } = database;

    await db.delete(boards).where(eq(boards.id, 'abcdefgh'));

    expect(await db.select().from(boardMoves).where(eq(boardMoves.boardId, 'abcdefgh'))).toEqual([]);
  });
});
