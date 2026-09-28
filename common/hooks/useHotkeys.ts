import { useEffect } from 'react';

import { isTypingTarget } from '@/common/lib/keyboard';

/**
 * Binds a single keyboard shortcut, guarding against firing while the user
 * is typing in an input — the same guard every keydown listener in this
 * codebase already repeats by hand (useMovesHandlers, useSelection,
 * useViewportGestures), centralised so Step 8's toolbar shortcuts don't add
 * another copy of it.
 */
export const useHotkeys = (
  matcher: (event: KeyboardEvent) => boolean,
  handler: (event: KeyboardEvent) => void,
) => {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (!matcher(event)) return;

      event.preventDefault();
      handler(event);
    };

    document.addEventListener('keydown', listener);

    return () => document.removeEventListener('keydown', listener);
  }, [matcher, handler]);
};
