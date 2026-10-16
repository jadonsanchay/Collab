import { decode } from '@auth/core/jwt';
import { parseCookie } from 'cookie';

/** Who a request or a socket handshake belongs to, once resolved. */
export type Identity = {
  userId: string;
  isGuest: boolean;
  name: string | null;
  /** The account handle; null for guests and accounts made before handles existed. */
  username: string | null;
  email: string | null;
  image: string | null;
};

/** Auth.js names its session cookie by scheme; the name is also the JWT salt. */
const SESSION_COOKIES = ['__Secure-authjs.session-token', 'authjs.session-token'];

/**
 * Reads the Auth.js session from a raw `Cookie` header without going through
 * Express: the socket handshake has only the header. Null when there is no
 * session or it does not verify.
 */
export const resolveSession = async (
  cookieHeader: string | undefined,
  secret: string,
): Promise<Identity | null> => {
  if (!cookieHeader) return null;

  const cookies = parseCookie(cookieHeader);
  const name = SESSION_COOKIES.find((candidate) => cookies[candidate]);

  if (!name) return null;

  try {
    const token = await decode({ token: cookies[name], secret, salt: name });

    if (!token?.sub) return null;

    return {
      userId: token.sub,
      isGuest: false,
      name: typeof token.name === 'string' ? token.name : null,
      username: typeof token.username === 'string' ? token.username : null,
      email: typeof token.email === 'string' ? token.email : null,
      image: typeof token.picture === 'string' ? token.picture : null,
    };
  } catch {
    return null;
  }
};
