import { useEffect, useState } from 'react';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandInput,
  CommandList,
} from '@/common/components/ui/command';
import { useFeatureFlag } from '@/common/hooks/useFeatureFlag';
import { isCommandPalette, isTypingTarget } from '@/common/lib/keyboard';
import { useAiStore } from '@/common/store/ai.store';
import { useSetBackground, useBackground } from '@/common/store/background.store';
import { useCallStore } from '@/common/store/call.store';
import { useHistoryStore } from '@/common/store/history.store';
import { usePresenceStore } from '@/common/store/presence.store';
import { useRoom } from '@/common/store/room.store';
import { useSetOptions } from '@/common/store/options.store';
import { useViewportSize } from '@/common/hooks/useViewportSize';
import { useViewportStore } from '@/common/store/viewport.store';

import { useRefs } from '../hooks/useRefs';
import { currentViewportRect, requestSketch } from '../lib/ai';
import { captureRegion } from '../lib/captureBoard';
import { useToolbarActionsContext } from '../modules/toolbar/context/ToolbarActions.context';

const CommandPalette = () => {
  const [open, setOpen] = useState(false);

  const setOptions = useSetOptions();
  const zoomTo = useViewportStore((state) => state.zoomTo);
  const fitToBoard = useViewportStore((state) => state.fitToBoard);
  const viewportSize = useViewportSize();
  const bg = useBackground();
  const setBackground = useSetBackground();
  const { handleDownload, handleShare, handleExit, openImageInput } =
    useToolbarActionsContext();
  const ai = useFeatureFlag('ai');
  const rewind = useFeatureFlag('rewind');
  const rtc = useFeatureFlag('rtc');
  const { canvasRef, bgRef } = useRefs();
  const { id: roomId } = useRoom();
  const callStatus = useCallStore((state) => state.status);
  const followSpeaker = usePresenceStore((state) => state.followSpeaker);

  const summarizeWithSketch = () => {
    const image = canvasRef.current
      ? captureRegion(canvasRef.current, bgRef.current, currentViewportRect())
      : null;

    requestSketch('summarize', { image: image ?? undefined });
  };

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (!isCommandPalette(event)) return;

      event.preventDefault();
      setOpen((prev) => !prev);
    };

    document.addEventListener('keydown', listener);

    return () => document.removeEventListener('keydown', listener);
  }, []);

  const run = (action: () => void) => () => {
    action();
    setOpen(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command..." />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        <CommandGroup heading="Tools">
          <CommandItem onSelect={run(() => setOptions((prev) => ({ ...prev, mode: 'draw', shape: 'line' })))}>
            Pen
          </CommandItem>
          <CommandItem onSelect={run(() => setOptions((prev) => ({ ...prev, mode: 'eraser' })))}>
            Eraser
          </CommandItem>
          <CommandItem onSelect={run(() => setOptions((prev) => ({ ...prev, mode: 'select' })))}>
            Select
          </CommandItem>
          <CommandItem onSelect={run(() => setOptions((prev) => ({ ...prev, mode: 'draw', shape: 'rect' })))}>
            Rectangle
          </CommandItem>
          <CommandItem onSelect={run(() => setOptions((prev) => ({ ...prev, mode: 'draw', shape: 'circle' })))}>
            Circle
          </CommandItem>
          <CommandItem onSelect={run(() => setOptions((prev) => ({ ...prev, mode: 'draw', shape: 'text' })))}>
            Text
          </CommandItem>
          <CommandItem onSelect={run(openImageInput)}>Insert image</CommandItem>
        </CommandGroup>

        <CommandGroup heading="View">
          <CommandItem
            onSelect={run(() =>
              zoomTo(useViewportStore.getState().scale * 1.1, viewportSize),
            )}
          >
            Zoom in
          </CommandItem>
          <CommandItem
            onSelect={run(() =>
              zoomTo(useViewportStore.getState().scale * 0.9, viewportSize),
            )}
          >
            Zoom out
          </CommandItem>
          <CommandItem onSelect={run(() => zoomTo(1, viewportSize))}>
            Reset zoom
          </CommandItem>
          <CommandItem onSelect={run(() => fitToBoard(viewportSize))}>
            Fit board
          </CommandItem>
          <CommandItem
            onSelect={run(() =>
              setBackground(bg.mode === 'dark' ? 'light' : 'dark', bg.lines),
            )}
          >
            Toggle theme
          </CommandItem>
          <CommandItem
            onSelect={run(() => setBackground(bg.mode, !bg.lines))}
          >
            Toggle grid
          </CommandItem>
        </CommandGroup>

        {ai && (
          <CommandGroup heading="Sketch">
            <CommandItem onSelect={run(() => useAiStore.getState().setPromptOpen(true))}>
              Ask Sketch to draw…
            </CommandItem>
            <CommandItem onSelect={run(summarizeWithSketch)}>
              Summarize board with Sketch
            </CommandItem>
          </CommandGroup>
        )}

        {rtc && (
          <CommandGroup heading="Call">
            {callStatus === 'idle' || callStatus === 'error' ? (
              <CommandItem onSelect={run(() => useCallStore.getState().join(roomId))}>
                Join call
              </CommandItem>
            ) : (
              <>
                <CommandItem onSelect={run(() => useCallStore.getState().leave())}>Leave call</CommandItem>
                <CommandItem onSelect={run(() => useCallStore.getState().toggles?.microphone())}>
                  Toggle microphone
                </CommandItem>
                <CommandItem onSelect={run(() => useCallStore.getState().toggles?.camera())}>
                  Toggle camera
                </CommandItem>
                <CommandItem onSelect={run(() => useCallStore.getState().toggles?.screenShare())}>
                  Share screen
                </CommandItem>
              </>
            )}
            <CommandItem
              onSelect={run(() => usePresenceStore.getState().setFollowSpeaker(!followSpeaker))}
            >
              {followSpeaker ? 'Stop following the speaker' : 'Follow the speaker'}
            </CommandItem>
          </CommandGroup>
        )}

        <CommandGroup heading="Room">
          {rewind && (
            <CommandItem onSelect={run(() => useHistoryStore.getState().setPanelOpen(true))}>
              Rewind history
            </CommandItem>
          )}
          <CommandItem onSelect={run(handleShare)}>Share</CommandItem>
          <CommandItem onSelect={run(handleDownload)}>Download</CommandItem>
          <CommandItem onSelect={run(handleExit)}>Leave room</CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};

export default CommandPalette;
