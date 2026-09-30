import { desc, eq, max } from 'drizzle-orm';
import { v4 } from 'uuid';

import type { Db } from '../db/client';
import { boardDocs, boardDocUpdates } from '../db/schema';
import type { VectorPersistence } from './docStore';

/** Vector documents in Postgres: the encoded state plus the update log. */
export class DbVectorPersistence implements VectorPersistence {
  constructor(private db: Db) {}

  async loadDoc(boardId: string) {
    const [row] = await this.db.select().from(boardDocs).where(eq(boardDocs.boardId, boardId));
    const [{ highest }] = await this.db
      .select({ highest: max(boardDocUpdates.seq) })
      .from(boardDocUpdates)
      .where(eq(boardDocUpdates.boardId, boardId));

    if (!row) return highest ? { state: Buffer.alloc(0), seq: Number(highest) } : null;

    return { state: row.state, seq: Number(highest ?? 0) };
  }

  async saveDoc(boardId: string, state: Buffer) {
    await this.db
      .insert(boardDocs)
      .values({ boardId, state, updatedAt: new Date() })
      .onConflictDoUpdate({ target: boardDocs.boardId, set: { state, updatedAt: new Date() } });
  }

  async appendUpdate(boardId: string, seq: number, userId: string | null, update: Buffer) {
    await this.db.insert(boardDocUpdates).values({ id: v4(), boardId, seq, userId, update });
  }

  /** Updates 1..seq in order, for reconstructing the document at a point in time. */
  async updatesUpTo(boardId: string, seq: number) {
    return this.db
      .select({ seq: boardDocUpdates.seq, update: boardDocUpdates.update, userId: boardDocUpdates.userId })
      .from(boardDocUpdates)
      .where(eq(boardDocUpdates.boardId, boardId))
      .orderBy(boardDocUpdates.seq)
      .then((rows) => rows.filter((row) => Number(row.seq) <= seq));
  }

  async latestSeq(boardId: string) {
    const [row] = await this.db
      .select({ seq: boardDocUpdates.seq })
      .from(boardDocUpdates)
      .where(eq(boardDocUpdates.boardId, boardId))
      .orderBy(desc(boardDocUpdates.seq))
      .limit(1);

    return row ? Number(row.seq) : 0;
  }
}
