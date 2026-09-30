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
  /**
   * The AI teammate. Off by default: with it off no AI code path runs and no
   * AI UI renders. On, it needs either a key or `AI_FAKE` to have an agent.
   */
  AI_ENABLED: z.stringbool().default(false),
  /** Deterministic agent for tests and keyless development. No network. */
  AI_FAKE: z.stringbool().default(false),
  /**
   * Which model API Sketch talks to. Unset means whichever key is present,
   * Anthropic first if both are. Both providers run the same prompts, schema
   * and validation; only the transport differs.
   */
  AI_PROVIDER: z.enum(['anthropic', 'openai']).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  AI_MODEL: z.string().min(1).default('claude-opus-5-5'),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).default('gpt-5.5'),
  /** The history panel. A closed panel by default; this hides it entirely. */
  REWIND_ENABLED: z.stringbool().default(true),
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
