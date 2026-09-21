import { z } from 'zod';

/**
 * Environment parsing, done once at startup so a typo in a deploy variable
 * fails immediately and loudly rather than silently becoming `NaN` somewhere
 * in a timer.
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  /**
   * How long a disconnected user keeps their place in the room — their colour,
   * their moves, their undo history. Long enough to cover a tunnel or a Wi-Fi
   * handover, short enough that someone who closed the tab stops showing up in
   * the avatar stack.
   */
  USER_GRACE_MS: z.coerce.number().int().nonnegative().default(60_000),
  /** How long an empty room is kept before its drawing is discarded. */
  ROOM_GRACE_MS: z.coerce.number().int().nonnegative().default(30 * 60_000),
  /** How often expired users and empty rooms are looked for. */
  SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
});

export type Config = z.infer<typeof envSchema>;

export const loadConfig = (
  env: Record<string, string | undefined> = process.env,
): Config => {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ');

    throw new Error(`Invalid environment configuration — ${issues}`);
  }

  return parsed.data;
};
