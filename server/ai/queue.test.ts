import { describe, expect, it } from 'vitest';

import { JobQueue } from './queue';

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** A job that resolves when told to, recording whether it was aborted. */
const controllable = (id: string) => {
  let release: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  const state = { started: false, aborted: false };

  return {
    state,
    release: () => release(),
    job: {
      id,
      run: (signal: AbortSignal) => {
        state.started = true;
        signal.addEventListener('abort', () => {
          state.aborted = true;
        });

        return done;
      },
    },
  };
};

describe('JobQueue', () => {
  it('runs at most `concurrency` jobs at once and starts the rest as slots free', async () => {
    const queue = new JobQueue({ concurrency: 2, maxLength: 10, timeoutMs: 1000 });
    const a = controllable('a');
    const b = controllable('b');
    const c = controllable('c');

    expect(queue.enqueue(a.job)).toBe('queued');
    expect(queue.enqueue(b.job)).toBe('queued');
    expect(queue.enqueue(c.job)).toBe('queued');

    expect(a.state.started).toBe(true);
    expect(b.state.started).toBe(true);
    expect(c.state.started).toBe(false);
    expect(queue.runningCount).toBe(2);

    a.release();
    await wait(0);

    expect(c.state.started).toBe(true);
    expect(queue.runningCount).toBe(2);

    b.release();
    c.release();
    await wait(0);

    expect(queue.size).toBe(0);
  });

  it('refuses work once the backlog is full', () => {
    const queue = new JobQueue({ concurrency: 1, maxLength: 1, timeoutMs: 1000 });

    expect(queue.enqueue(controllable('running').job)).toBe('queued');
    expect(queue.enqueue(controllable('waiting').job)).toBe('queued');
    expect(queue.enqueue(controllable('too-many').job)).toBe('full');

    queue.stop();
  });

  it('times a job out, tells it, aborts it, and reclaims the slot', async () => {
    const queue = new JobQueue({ concurrency: 1, maxLength: 5, timeoutMs: 20 });
    const stuck = controllable('stuck');
    const next = controllable('next');
    let timedOut = false;

    queue.enqueue({ ...stuck.job, onTimeout: () => { timedOut = true; } });
    queue.enqueue(next.job);

    expect(next.state.started).toBe(false);

    await wait(60);

    expect(timedOut).toBe(true);
    expect(stuck.state.aborted).toBe(true);
    // The slot was freed although the stuck job never settled.
    expect(next.state.started).toBe(true);

    next.release();
    stuck.release();
  });

  it('aborts a running job and removes a waiting one', async () => {
    const queue = new JobQueue({ concurrency: 1, maxLength: 5, timeoutMs: 1000 });
    const running = controllable('running');
    const waiting = controllable('waiting');

    queue.enqueue(running.job);
    queue.enqueue(waiting.job);

    expect(queue.abort('waiting')).toBe(true);
    expect(queue.size).toBe(1);

    expect(queue.abort('running')).toBe(true);
    expect(running.state.aborted).toBe(true);

    expect(queue.abort('unknown')).toBe(false);

    running.release();
    await wait(0);

    expect(waiting.state.started).toBe(false);
    expect(queue.size).toBe(0);
  });

  it('never lets a rejecting job poison the queue', async () => {
    const queue = new JobQueue({ concurrency: 1, maxLength: 5, timeoutMs: 1000 });
    const after = controllable('after');

    queue.enqueue({ id: 'boom', run: () => Promise.reject(new Error('boom')) });
    queue.enqueue(after.job);

    await wait(0);

    expect(after.state.started).toBe(true);
    after.release();
  });
});
