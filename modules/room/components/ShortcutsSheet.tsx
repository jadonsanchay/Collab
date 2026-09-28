import { useEffect, useState } from 'react';

import { Kbd } from '@/common/components/ui/kbd';
import { Sheet, SheetContent, SheetTitle } from '@/common/components/ui/sheet';
import { isShortcutsSheet, isTypingTarget } from '@/common/lib/keyboard';

const SHORTCUTS: [string, string][] = [
  ['Pen', 'P'],
  ['Eraser', 'E'],
  ['Select', 'V'],
  ['Hand (pan)', 'H'],
  ['Line', 'L'],
  ['Rectangle', 'R'],
  ['Circle', 'O'],
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
  ['Command palette', '⌘K'],
  ['Shortcuts', '?'],
];

const ShortcutsSheet = () => {
  const [open, setOpen] = useState(false);

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
          {SHORTCUTS.map(([label, hotkey]) => (
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
