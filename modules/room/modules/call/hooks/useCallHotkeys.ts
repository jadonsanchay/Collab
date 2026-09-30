import { useEffect } from 'react';

import { isCameraToggle, isMicToggle, isTypingTarget } from '@/common/lib/keyboard';
import { useCallStore } from '@/common/store/call.store';

/** Cmd+Shift+D and Cmd+Shift+E while in a call. Neither collides with the Phase 1 table. */
export const useCallHotkeys = () => {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;

      const { toggles } = useCallStore.getState();
      if (!toggles) return;

      if (isMicToggle(event)) {
        event.preventDefault();
        toggles.microphone();
      } else if (isCameraToggle(event)) {
        event.preventDefault();
        toggles.camera();
      }
    };

    document.addEventListener('keydown', listener);

    return () => document.removeEventListener('keydown', listener);
  }, []);
};
