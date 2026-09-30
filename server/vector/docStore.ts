import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';

import { logger } from '../logger';

/** How a vector board's document is kept across restarts. Null in memory mode. */
export interface VectorPersistence {
  loadDoc(boardId: string): Promise<{ state: Buffer; seq: number } | null>;
  saveDoc(boardId: string, state: Buffer): Promise<void>;
  appendUpdate(boardId: string, seq: number, userId: string | null, update: Buffer): Promise<void>;
}

/** What a change carries as its transaction origin, so updates can be attributed. */
export type UpdateOrigin = { userId: string | null; conn?: unknown };

export type DocEntry = {
  boardId: string;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  /** Open connections; the entry is evicted a while after the last one leaves. */
  conns: Set<unknown>;
  /** Sequence of the last update applied, persisted or not. */
  seq: number;
  dirty: boolean;
};

export type DocStoreOptions = {
  /** Quiet time before the encoded document is written. */
  saveDebounceMs: number;
  /** Time an unused document stays in memory. */
  evictAfterMs: number;
};

const DEFAULT_OPTIONS: DocStoreOptions = { saveDebounceMs: 1000, evictAfterMs: 60_000 };

/**
 * The server's copy of every open vector document. It is the sync hub:
 * connections apply their updates here and receive everyone else's, the
 * AI teammate and the upgrade job write straight into it, and every update
 * is appended to the log with a sequence number so Rewind can replay it.
 * The encoded state is saved on a debounce and on eviction.
 */
export class VectorDocStore {
  private entries = new Map<string, DocEntry>();

  private loading = new Map<string, Promise<DocEntry>>();

  private saveTimers = new Map<string, NodeJS.Timeout>();

  private evictTimers = new Map<string, NodeJS.Timeout>();

  private options: DocStoreOptions;

  constructor(
    private persistence: VectorPersistence | null,
    options: Partial<DocStoreOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  get(boardId: string): DocEntry | undefined {
    return this.entries.get(boardId);
  }

  /** The document, loaded from the record if there is one. Concurrent opens share a load. */
  async open(boardId: string): Promise<DocEntry> {
    const existing = this.entries.get(boardId);
    if (existing) {
      this.cancelEviction(boardId);
      return existing;
    }

    const pending = this.loading.get(boardId);
    if (pending) return pending;

    const load = this.load(boardId).finally(() => this.loading.delete(boardId));
    this.loading.set(boardId, load);

    return load;
  }

  /** A connection went away; with none left, the document is saved and evicted later. */
  release(boardId: string) {
    const entry = this.entries.get(boardId);
    if (!entry || entry.conns.size) return;

    this.cancelEviction(boardId);

    const timer = setTimeout(() => {
      this.evictTimers.delete(boardId);
      this.evict(boardId).catch((error) => logger.error({ err: error, boardId }, 'evict failed'));
    }, this.options.evictAfterMs);
    timer.unref?.();

    this.evictTimers.set(boardId, timer);
  }

  /** Writes every dirty document now. */
  async flush() {
    await Promise.all([...this.entries.keys()].map((boardId) => this.save(boardId)));
  }

  async stop() {
    this.saveTimers.forEach((timer) => clearTimeout(timer));
    this.evictTimers.forEach((timer) => clearTimeout(timer));
    this.saveTimers.clear();
    this.evictTimers.clear();
    await this.flush();
    this.entries.forEach((entry) => entry.doc.destroy());
    this.entries.clear();
  }

  private async load(boardId: string): Promise<DocEntry> {
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalState(null);

    const stored = await this.persistence?.loadDoc(boardId);

    if (stored) Y.applyUpdate(doc, new Uint8Array(stored.state), 'load');

    const entry: DocEntry = {
      boardId,
      doc,
      awareness,
      conns: new Set(),
      seq: stored?.seq ?? 0,
      dirty: false,
    };

    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'load') return;

      entry.seq += 1;
      entry.dirty = true;

      const userId =
        origin && typeof origin === 'object' && 'userId' in origin
          ? ((origin as UpdateOrigin).userId ?? null)
          : null;

      this.persistence
        ?.appendUpdate(boardId, entry.seq, userId, Buffer.from(update))
        .catch((error) => logger.warn({ err: error, boardId }, 'could not log a doc update'));

      this.scheduleSave(boardId);
    });

    this.entries.set(boardId, entry);

    return entry;
  }

  private scheduleSave(boardId: string) {
    if (!this.persistence || this.saveTimers.has(boardId)) return;

    const timer = setTimeout(() => {
      this.saveTimers.delete(boardId);
      this.save(boardId).catch((error) => logger.warn({ err: error, boardId }, 'could not save a doc'));
    }, this.options.saveDebounceMs);
    timer.unref?.();

    this.saveTimers.set(boardId, timer);
  }

  private async save(boardId: string) {
    const entry = this.entries.get(boardId);
    if (!entry || !entry.dirty || !this.persistence) return;

    entry.dirty = false;
    await this.persistence.saveDoc(boardId, Buffer.from(Y.encodeStateAsUpdate(entry.doc)));
  }

  private cancelEviction(boardId: string) {
    const timer = this.evictTimers.get(boardId);
    if (timer) clearTimeout(timer);
    this.evictTimers.delete(boardId);
  }

  private async evict(boardId: string) {
    const entry = this.entries.get(boardId);
    if (!entry || entry.conns.size) return;

    const pendingSave = this.saveTimers.get(boardId);
    if (pendingSave) clearTimeout(pendingSave);
    this.saveTimers.delete(boardId);

    await this.save(boardId);
    entry.awareness.destroy();
    entry.doc.destroy();
    this.entries.delete(boardId);
  }
}
