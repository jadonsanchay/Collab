import { randomUUID } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SNAPSHOT_USER_ID } from '@/common/constants/system';

import { BoardStore } from '../boards/BoardStore';
import { DbPersistence } from '../boards/dbPersistence';
import { createPglite, type Database } from '../db/client';
import { boards, boardSnapshots } from '../db/schema';
import { RoomStore } from '../rooms/RoomStore';
import { LocalStorage } from '../storage/local';
import { makeMove } from '../testing/fixtures';
import { SnapshotService } from './snapshots';

const black = { r: 0, g: 0, b: 0, a: 1 };

const stroke = (i: number) =>
  makeMove({
    path: [
      [100 + i * 10, 100],
      [100 + i * 10, 400],
    ],
    options: { ...makeMove().options, lineWidth: 8, lineColor: black },
  });

describe('SnapshotService', () => {
  let dir: string;
  let database: Database;
  let storage: LocalStorage;
  let persistence: DbPersistence;
  let rooms: RoomStore;
  let store: BoardStore;
  let snapshots: SnapshotService;
  let roomId: string;
  const alice = randomUUID();

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'collab-snapshots-'));
    database = await createPglite();
    storage = new LocalStorage({ dir, secret: 's' });
    persistence = new DbPersistence(database, { flushMs: 5, storage });
    rooms = new RoomStore({ sweepIntervalMs: 60_000 });

    store = new BoardStore(rooms, persistence, {
      onActivity: (id) => snapshots.noteActivity(id),
    });
    snapshots = new SnapshotService(store, database, storage, {
      snapshotEvery: 5,
      thumbnailDebounceMs: 30,
      keepSnapshots: 2,
    });

    ({ roomId } = await store.create(alice, 'Alice', 's1', 'Snapshots'));
  }, 60_000);

  afterAll(async () => {
    snapshots.stop();
    rooms.stop();
    await persistence.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('renders a snapshot once enough moves have landed, and a thumbnail after a pause', async () => {
    for (let i = 0; i < 5; i += 1) store.addMove(roomId, alice, stroke(i));

    await snapshots.drain();
    await new Promise((resolve) => {
      setTimeout(resolve, 80);
    });
    await snapshots.drain();
    await persistence.flush();

    const rows = await database.db
      .select()
      .from(boardSnapshots)
      .where(eq(boardSnapshots.boardId, roomId));

    expect(rows).toHaveLength(1);
    expect(Number(rows[0].seq)).toBe(5);
    expect(rows[0].width).toBe(4000);
    expect(await storage.get(rows[0].imageKey)).not.toBeNull();
    expect(store.get(roomId)?.snapshotSeq).toBe(5);

    const [board] = await database.db.select().from(boards).where(eq(boards.id, roomId));

    expect(board.thumbnailKey).toBe(`boards/${roomId}/thumb.webp`);
    expect(await storage.get(board.thumbnailKey as string)).not.toBeNull();
  });

  it('loads a cold board as the snapshot image plus the moves after it', async () => {
    // Two more moves after the snapshot.
    store.addMove(roomId, alice, stroke(5));
    store.addMove(roomId, alice, stroke(6));
    await persistence.flush();

    const loaded = await persistence.loadRoom(roomId);

    expect(loaded?.snapshot).toMatchObject({ seq: 5, width: 4000, height: 2000 });
    expect(loaded?.snapshot?.url).toBe(`/uploads/boards/${roomId}/snapshots/5.png`);
    expect(loaded?.moves.map((move) => move.seq)).toEqual([6, 7]);
    expect(loaded?.seq).toBe(7);

    // A fresh store hydrates it with the synthetic image move first.
    const fresh = new RoomStore({ sweepIntervalMs: 60_000 });
    const room = fresh.hydrate(roomId, loaded as NonNullable<typeof loaded>);

    expect(room.drawed.map((move) => move.seq)).toEqual([5, 6, 7]);
    expect(room.drawed[0]).toMatchObject({
      userId: SNAPSHOT_USER_ID,
      options: { shape: 'image' },
      img: { url: loaded?.snapshot?.url, width: 4000, height: 2000 },
    });
    expect(room.snapshotSeq).toBe(5);
    expect(room.seq).toBe(7);

    fresh.stop();
  });

  it('keeps only the most recent snapshots and deletes the rest', async () => {
    // Snapshots at 10 and 15 push the one at 5 out (keepSnapshots is 2).
    for (let i = 7; i < 15; i += 1) store.addMove(roomId, alice, stroke(i));

    await snapshots.drain();
    await persistence.flush();

    const rows = await database.db
      .select()
      .from(boardSnapshots)
      .where(eq(boardSnapshots.boardId, roomId));

    expect(rows.map((row) => Number(row.seq)).sort((a, b) => a - b)).toEqual([10, 15]);
    expect(await storage.get(`boards/${roomId}/snapshots/5.png`)).toBeNull();
    expect(await storage.get(`boards/${roomId}/snapshots/15.png`)).not.toBeNull();
  });

  it('ignores rooms it does not know', async () => {
    snapshots.noteActivity('nowhere1');
    await snapshots.snapshot('nowhere1');
    await snapshots.thumbnail('nowhere1');
  });
});
