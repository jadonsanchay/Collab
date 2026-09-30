export type QueueOptions = {
  /** Jobs running at once. Each is one model call plus an animation. */
  concurrency: number;
  /** Jobs waiting for a slot. Beyond this, callers are told to try later. */
  maxLength: number;
  /** A job still running after this is aborted and its slot reclaimed. */
  timeoutMs: number;
};

export const DEFAULT_QUEUE: QueueOptions = {
  concurrency: 2,
  maxLength: 10,
  timeoutMs: 90_000,
};

export type QueuedJob = {
  id: string;
  run: (signal: AbortSignal) => Promise<void>;
  onTimeout?: () => void;
};

/**
 * A small in-process job queue: bounded concurrency, bounded backlog, a hard
 * timeout per job. Sufficient for one node; Phase 3 replaces it with BullMQ
 * when there are several.
 *
 * A job never rejects the queue: `run` failures are the job's own business,
 * and the slot is reclaimed either way.
 */
export class JobQueue {
  private waiting: QueuedJob[] = [];

  private running = new Map<string, AbortController>();

  private options: QueueOptions;

  constructor(options: Partial<QueueOptions> = {}) {
    this.options = { ...DEFAULT_QUEUE, ...options };
  }

  get size() {
    return this.waiting.length + this.running.size;
  }

  get runningCount() {
    return this.running.size;
  }

  enqueue(job: QueuedJob): 'queued' | 'full' {
    // A free slot is taken straight away; the backlog cap only applies to
    // jobs that would have to wait.
    if (this.running.size < this.options.concurrency) {
      this.start(job);

      return 'queued';
    }

    if (this.waiting.length >= this.options.maxLength) return 'full';

    this.waiting.push(job);

    return 'queued';
  }

  /** Cancels a waiting job or aborts a running one. False when unknown. */
  abort(id: string): boolean {
    const index = this.waiting.findIndex((job) => job.id === id);

    if (index !== -1) {
      this.waiting.splice(index, 1);

      return true;
    }

    const controller = this.running.get(id);

    if (!controller) return false;

    controller.abort();

    return true;
  }

  stop() {
    this.waiting = [];
    this.running.forEach((controller) => controller.abort());
    this.running.clear();
  }

  private pump() {
    while (
      this.running.size < this.options.concurrency &&
      this.waiting.length > 0
    ) {
      const job = this.waiting.shift();

      if (job) this.start(job);
    }
  }

  private start(job: QueuedJob) {
    const controller = new AbortController();
    this.running.set(job.id, controller);

    let finished = false;
    let timer: NodeJS.Timeout | null = null;

    const finish = () => {
      if (finished) return;
      finished = true;

      if (timer) clearTimeout(timer);
      this.running.delete(job.id);
      this.pump();
    };

    timer = setTimeout(() => {
      if (finished) return;

      job.onTimeout?.();
      controller.abort();
      // Reclaim the slot even if the job ignores the signal and never settles.
      finish();
    }, this.options.timeoutMs);

    timer.unref?.();

    job.run(controller.signal).then(finish, finish);
  }
}
