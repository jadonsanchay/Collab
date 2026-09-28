import { RateLimiterMemory } from 'rate-limiter-flexible';

/**
 * Per-socket limits, chosen with headroom over what the UI can produce: the
 * cursor ticks a few times a second, a fast drawer finishes a stroke in well
 * under 50ms, and nobody types five chat messages a second by hand. Normal use
 * never approaches these.
 *
 * The memory backend is deliberate for now. Phase 3 swaps it for the Redis one
 * from the same library once there is more than one server process, since
 * per-process counters stop meaning anything behind a load balancer.
 */
const limiters = {
  draw: new RateLimiterMemory({ points: 20, duration: 1 }),
  mouse_move: new RateLimiterMemory({ points: 30, duration: 1 }),
  send_msg: new RateLimiterMemory({ points: 5, duration: 1 }),
  // One frame's worth of points, batched client-side, arriving well under
  // 60 times a second in practice.
  stroke_points: new RateLimiterMemory({ points: 60, duration: 1 }),
  // Room churn is the expensive one: each create allocates a room that lives
  // until everyone leaves, so creates and joins share a slower budget.
  room_entry: new RateLimiterMemory({ points: 5, duration: 10 }),
};

export type LimitedEvent = keyof typeof limiters;

/**
 * Returns true when the event is within budget. Never throws and never
 * rejects: the caller gets a boolean and decides what to drop.
 *
 * Budgets are keyed by the stable `userId`, not by `socket.id`, and are never
 * cleared early. Keyed by connection, reconnecting would hand out a fresh
 * budget, which is exactly the move a client being throttled would make.
 * Counters expire on their own once the window passes.
 */
export const withinLimit = async (
  event: LimitedEvent,
  userId: string,
): Promise<boolean> => {
  try {
    await limiters[event].consume(userId);

    return true;
  } catch {
    // `consume` rejects with the limiter state when the budget is spent, which
    // is an expected outcome here rather than an error.
    return false;
  }
};
