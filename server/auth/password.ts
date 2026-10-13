import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** Work factor: ~64 MB and tens of milliseconds per hash, interactive-login grade. */
const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const KEY_LENGTH = 64;

/**
 * Password hashing with Node's own scrypt, so there is no native dependency
 * to build. The stored string carries its parameters and salt, which is what
 * lets the work factor change later without invalidating old hashes.
 */
export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, PARAMS);

  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${key.toString('base64')}`;
};

export const verifyPassword = async (password: string, stored: string | null | undefined): Promise<boolean> => {
  if (!stored) return false;

  const [scheme, n, r, p, salt, expected] = stored.split('$');

  if (scheme !== 'scrypt' || !salt || !expected) return false;

  const key = await scrypt(password, Buffer.from(salt, 'base64'), KEY_LENGTH, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: PARAMS.maxmem,
  });
  const expectedBytes = Buffer.from(expected, 'base64');

  return key.length === expectedBytes.length && timingSafeEqual(key, expectedBytes);
};
