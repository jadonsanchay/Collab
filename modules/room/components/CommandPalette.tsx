import { useEffect, useState } from 'react';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandInput,
  CommandList,
} from '@/common/components/ui/command';
import { isCommandPalette, isTypingTarget } from '@/common/lib/keyboard';
import { useSetBackground, useBackground } from '@/common/store/background.store';
import { useSetOptions } from '@/common/store/options.store';
import { useViewportSize } from '@/common/hooks/useViewportSize';
import { useViewportStore } from '@/common/store/viewport.store';

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

        <CommandGroup heading="Room">
          <CommandItem onSelect={run(handleShare)}>Share</CommandItem>
          <CommandItem onSelect={run(handleDownload)}>Download</CommandItem>
          <CommandItem onSelect={run(handleExit)}>Leave room</CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};

export default CommandPalette;
