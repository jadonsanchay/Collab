import { useEffect, useState } from 'react';

import { toast } from 'sonner';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandInput,
  CommandList,
} from '@/common/components/ui/command';
import { canManage } from '@/common/constants/roles';
import { useFeatureFlag } from '@/common/hooks/useFeatureFlag';
import { useViewportSize } from '@/common/hooks/useViewportSize';
import { isCommandPalette, isTypingTarget } from '@/common/lib/keyboard';
import { useAiStore } from '@/common/store/ai.store';
import { useSetBackground, useBackground } from '@/common/store/background.store';
import { useCallStore } from '@/common/store/call.store';
import { useHistoryStore } from '@/common/store/history.store';
import { useSetOptions } from '@/common/store/options.store';
import { usePresenceStore } from '@/common/store/presence.store';
import { useMyRole, useRoom } from '@/common/store/room.store';
import { useVectorStore, type VectorTool } from '@/common/store/vector.store';
import { useViewportStore } from '@/common/store/viewport.store';
import { DEFAULT_CAMERA, fitTo, zoomAt } from '@/common/vector/camera';
import { contentBoundsOf, downloadSvg } from '@/modules/vector/lib/svg';

import { useRefs } from '../hooks/useRefs';
import { currentViewportRect, requestSketch } from '../lib/ai';
import { captureRegion } from '../lib/captureBoard';
import { useToolbarActionsContext } from '../modules/toolbar/context/ToolbarActions.context';

const VECTOR_TOOLS: [VectorTool, string][] = [
  ['select', 'Select'],
  ['hand', 'Hand'],
  ['pen', 'Pen'],
  ['eraser', 'Eraser'],
  ['rect', 'Rectangle'],
  ['ellipse', 'Ellipse'],
  ['line', 'Line'],
  ['arrow', 'Arrow'],
  ['text', 'Text'],
  ['sticky', 'Sticky note'],
  ['connector', 'Connector'],
  ['frame', 'Frame'],
];

/** The palette's own zoom steps, in the middle of the window. */
const zoomVectorBy = (factor: number, viewport: { width: number; height: number }) => {
  const { camera, setCamera } = useVectorStore.getState();

  setCamera(zoomAt(camera, { x: viewport.width / 2, y: viewport.height / 2 }, factor));
};

const fitVectorContent = (viewport: { width: number; height: number }) => {
  const { objects, setCamera } = useVectorStore.getState();
  const bounds = contentBoundsOf(objects, 0);

  setCamera(bounds ? fitTo(bounds, viewport) : DEFAULT_CAMERA);
};

/**
 * Cmd+K. The tool and view commands come from whichever engine the board
 * runs; Sketch, calls and the room commands are the same for both.
 */
const CommandPalette = () => {
  const [open, setOpen] = useState(false);

  const setOptions = useSetOptions();
  const zoomTo = useViewportStore((state) => state.zoomTo);
  const fitToBoard = useViewportStore((state) => state.fitToBoard);
  const viewportSize = useViewportSize();
  const bg = useBackground();
  const setBackground = useSetBackground();
  const { handleDownload, handleShare, handleExit, openImageInput } = useToolbarActionsContext();
  const ai = useFeatureFlag('ai');
  const rewind = useFeatureFlag('rewind');
  const rtc = useFeatureFlag('rtc');
  const persistent = useFeatureFlag('persistent');
  const vectorAvailable = useFeatureFlag('vector');
  const { canvasRef, bgRef } = useRefs();
  const { id: roomId, engine } = useRoom();
  const role = useMyRole();
  const callStatus = useCallStore((state) => state.status);
  const followSpeaker = usePresenceStore((state) => state.followSpeaker);

  const vector = engine === 'vector';

  const summarizeWithSketch = () => {
    const image = canvasRef.current
      ? captureRegion(canvasRef.current, bgRef.current, currentViewportRect())
      : null;

    requestSketch('summarize', { image: image ?? undefined });
  };

  const convertToObjects = async () => {
    const response = await fetch(`/api/boards/${roomId}/upgrade`, { method: 'POST' });

    if (response.ok) {
      toast.success('Converted to an objects board. Everything you drew is now selectable.');
      return;
    }

    const body = (await response.json().catch(() => ({}))) as { error?: string };
    toast.error(body.error ?? 'The board could not be converted.');
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

        {vector ? (
          <CommandGroup heading="Tools">
            {VECTOR_TOOLS.map(([tool, label]) => (
              <CommandItem key={tool} onSelect={run(() => useVectorStore.getState().setTool(tool))}>
                {label}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : (
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
        )}

        {vector ? (
          <CommandGroup heading="View">
            <CommandItem onSelect={run(() => zoomVectorBy(1.2, viewportSize))}>Zoom in</CommandItem>
            <CommandItem onSelect={run(() => zoomVectorBy(1 / 1.2, viewportSize))}>Zoom out</CommandItem>
            <CommandItem
              onSelect={run(() => useVectorStore.getState().setCamera({ ...useVectorStore.getState().camera, zoom: 1 }))}
            >
              Reset zoom
            </CommandItem>
            <CommandItem onSelect={run(() => fitVectorContent(viewportSize))}>Fit content</CommandItem>
          </CommandGroup>
        ) : (
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
        )}

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
          {rewind && (!vector || persistent) && (
            <CommandItem onSelect={run(() => useHistoryStore.getState().setPanelOpen(true))}>
              Rewind history
            </CommandItem>
          )}
          <CommandItem onSelect={run(handleShare)}>Share</CommandItem>
          {vector ? (
            <CommandItem
              onSelect={run(() => downloadSvg(useVectorStore.getState().objects, `collab-${roomId}.svg`))}
            >
              Export SVG
            </CommandItem>
          ) : (
            <CommandItem onSelect={run(handleDownload)}>Download</CommandItem>
          )}
          {!vector && vectorAvailable && persistent && canManage(role) && (
            <CommandItem onSelect={run(convertToObjects)}>Convert to objects board (beta)</CommandItem>
          )}
          <CommandItem onSelect={run(handleExit)}>Leave room</CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};

export default CommandPalette;
