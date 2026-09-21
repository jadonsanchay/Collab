import type { ClientToServerEvents } from '@/common/types/global';

import { logger } from '../logger';

/**
 * Argument tuples for every event the server listens to: the client-to-server
 * contract, plus Socket.IO's reserved `disconnecting`. Deriving them from the
 * contract is what lets each handler's parameters infer at the call site
 * instead of being annotated by hand.
 */
type HandlerArgs = {
  [E in keyof ClientToServerEvents]: Parameters<ClientToServerEvents[E]>;
} & { disconnecting: [] };

/**
 * Wraps a socket event handler so a throw is logged instead of reaching
 * Socket.IO's uncaught-exception path, which takes the whole process down.
 *
 * Guards inside the handlers are the real fix for the crash paths we know
 * about; this is the backstop for the ones we do not, and for everything later
 * phases add. Rejected promises are caught too, so an async handler cannot
 * become an unhandled rejection.
 */
export const safeHandler =
  <E extends keyof HandlerArgs>(
    event: E,
    handler: (...args: HandlerArgs[E]) => void | Promise<void>,
  ) =>
  (...args: HandlerArgs[E]): void => {
    try {
      const result = handler(...args);

      if (result instanceof Promise) {
        result.catch((error) => {
          logger.error({ err: error, event }, 'socket handler rejected');
        });
      }
    } catch (error) {
      logger.error({ err: error, event }, 'socket handler threw');
    }
  };
