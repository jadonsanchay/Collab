import type Redis from 'ioredis';
import {
  RateLimiterMemory,
  RateLimiterRedis,
  type RateLimiterAbstract,
} from 'rate-limiter-flexible';

/**
 * Per-user budgets, chosen with headroom over what the UI can produce: the
 * cursor ticks a few times a second, a fast drawer finishes a stroke in well
 * under 50ms, and nobody types five chat messages a second by hand. Normal
 * use never approaches these.
 */
const BUDGETS = {
  draw: { points: 20, duration: 1 },
  send_msg: { points: 5, duration: 1 },
  // One frame's worth of points, batched client-side, arriving well under
  // 60 times a second in practice.
  stroke_points: { points: 60, duration: 1 },
  cursor: { points: 30, duration: 1 },
  viewport: { points: 10, duration: 1 },
  // Rare and room-wide by nature: nobody summons more than once every few
  // seconds on purpose.
  summon: { points: 1, duration: 5 },
  // Room churn is the expensive one: each create allocates a room that lives
  // until everyone leaves, so creates and joins share a slower budget.
  room_entry: { points: 5, duration: 10 },
  // Each one is a model call. The per-room budget in server/ai/limits.ts is
  // the real cost control; this just stops one person hammering the button.
  ai_request: { points: 3, duration: 10 },
} as const;

export type LimitedEvent = keyof typeof BUDGETS;

type Limiters = Record<LimitedEvent, RateLimiterAbstract>;

/**
 * Memory-backed by default. With Redis, every node counts against the same
 * budget, which is what a limit behind a load balancer has to do; the memory
 * limiter stays as insurance so a Redis outage does not turn into no limits.
 */
const build = (redis?: Redis): Limiters =>
  Object.fromEntries(
    (Object.keys(BUDGETS) as LimitedEvent[]).map((event) => {
      const budget = BUDGETS[event];

      return [
        event,
        redis
          ? new RateLimiterRedis({
              storeClient: redis,
              keyPrefix: `rl:${event}`,
              ...budget,
              insuranceLimiter: new RateLimiterMemory(budget),
            })
          : new RateLimiterMemory(budget),
      ];
    }),
  ) as unknown as Limiters;

let limiters = build();

/** Switches every budget to Redis so several nodes share one count. */
export const enableRedisRateLimits = (redis: Redis) => {
  limiters = build(redis);
};

export const resetRateLimits = () => {
  limiters = build();
};

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
