import { useEffect, useState } from 'react';

import { Kbd } from '@/common/components/ui/kbd';
import { Sheet, SheetContent, SheetTitle } from '@/common/components/ui/sheet';
import { isShortcutsSheet, isTypingTarget } from '@/common/lib/keyboard';
import { useRoom } from '@/common/store/room.store';

const SHARED: [string, string][] = [
  ['Rewind', '⌘⇧H'],
  ['Mute / unmute (in a call)', '⌘⇧D'],
  ['Camera on / off (in a call)', '⌘⇧E'],
  ['Command palette', '⌘K'],
  ['Shortcuts', '?'],
];

const RASTER_SHORTCUTS: [string, string][] = [
  ['Pen', 'P'],
  ['Eraser', 'E'],
  ['Select', 'V'],
  ['Hand (pan)', 'H'],
  ['Line', 'L'],
  ['Rectangle', 'R'],
  ['Circle', 'O'],
  ['Text', 'T'],
  ['Image', 'I'],
  ['Decrease width', '['],
  ['Increase width', ']'],
  ['Undo', '⌘Z'],
  ['Redo', '⌘⇧Z'],
  ['Copy selection', '⌘C'],
  ['Delete selection', 'Delete'],
  ['Zoom in', '⌘='],
  ['Zoom out', '⌘-'],
  ['Reset zoom', '⌘0'],
  ['Fit board', '⇧1'],
  ...SHARED,
];

const VECTOR_SHORTCUTS: [string, string][] = [
  ['Select', 'V'],
  ['Hand (pan)', 'H'],
  ['Pen', 'P'],
  ['Eraser', 'E'],
  ['Rectangle', 'R'],
  ['Ellipse', 'O'],
  ['Line', 'L'],
  ['Arrow', 'A'],
  ['Text', 'T'],
  ['Sticky note', 'S'],
  ['Connector', 'C'],
  ['Frame', 'F'],
  ['Undo', '⌘Z'],
  ['Redo', '⌘⇧Z'],
  ['Select all', '⌘A'],
  ['Duplicate', '⌘D'],
  ['Delete selection', 'Delete'],
  ['Edit text of selection', 'Enter'],
  ['Bring forward / send backward', '⌘] / ⌘['],
  ['Bring to front / send to back', '⌘⇧] / ⌘⇧['],
  ['Lock / unlock', '⌘⇧L'],
  ['Nudge selection', 'Arrows'],
  ['Zoom', '⌘ + scroll'],
  ...SHARED,
];

const ShortcutsSheet = () => {
  const [open, setOpen] = useState(false);
  const { engine } = useRoom();
  const shortcuts = engine === 'vector' ? VECTOR_SHORTCUTS : RASTER_SHORTCUTS;

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (!isShortcutsSheet(event)) return;

      event.preventDefault();
      setOpen((prev) => !prev);
    };

    document.addEventListener('keydown', listener);

    return () => document.removeEventListener('keydown', listener);
  }, []);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right">
        <SheetTitle>Keyboard shortcuts</SheetTitle>
        <ul className="mt-4 flex flex-col gap-2">
          {shortcuts.map(([label, hotkey]) => (
            <li key={label} className="flex items-center justify-between gap-4">
              <span>{label}</span>
              <Kbd>{hotkey}</Kbd>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
};

export default ShortcutsSheet;
