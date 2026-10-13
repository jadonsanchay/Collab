import { z } from 'zod';

export const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/u;

export const MIN_PASSWORD_LENGTH = 8;

/** What the sign-up form sends. The username is a handle: lowercase letters, digits, underscores. */
export const registerSchema = z.object({
  name: z.string().trim().min(1).max(40),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(USERNAME_PATTERN, '3 to 24 lowercase letters, digits or underscores'),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(128),
});

/** Sign in with the email or the username, plus the password. */
export const loginSchema = z.object({
  identifier: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(128),
});

export type RegisterInput = z.infer<typeof registerSchema>;
