import { RateLimiterMemory } from 'rate-limiter-flexible';

export type LimitOptions = {
  /** Requests any one room may make inside the window. */
  roomRequests: number;
  roomWindowS: number;
};

export const DEFAULT_LIMITS: LimitOptions = {
  roomRequests: 10,
  roomWindowS: 600,
};

/**
 * Per-room budget, on top of the per-user socket rate limit. The socket
 * limit stops one person spamming; this stops a whole room from running up
 * a bill. Memory-backed for now, like every other limiter; Phase 3 moves
 * them all to Redis together.
 */
export const createLimits = (options: Partial<LimitOptions> = {}) => {
  const { roomRequests, roomWindowS } = { ...DEFAULT_LIMITS, ...options };

  const perRoom = new RateLimiterMemory({
    points: roomRequests,
    duration: roomWindowS,
  });

  return {
    allowRoomRequest: async (roomId: string): Promise<boolean> => {
      try {
        await perRoom.consume(roomId);

        return true;
      } catch {
        // `consume` rejects when the budget is spent: expected, not an error.
        return false;
      }
    },
  };
};

export type Limits = ReturnType<typeof createLimits>;
