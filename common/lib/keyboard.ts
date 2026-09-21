/**
 * Shortcut matching for the board.
 *
 * Two things were wrong before this existed: every shortcut tested `ctrlKey`
 * only, so none of them worked on macOS, and they were all bound to `document`
 * with no check on what had focus, so typing "zyc" in the chat box fired undo,
 * redo and copy.
 */

/** Cmd on macOS, Ctrl elsewhere. Accepting either keeps both platforms working. */
const hasModifier = (event: KeyboardEvent) => event.metaKey || event.ctrlKey;

/**
 * True when the event came from somewhere the user is typing, in which case the
 * board should keep its hands off the keystroke.
 */
export const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;

  const tag = target.tagName;

  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    // Compared against true rather than relied on for truthiness: the DOM
    // types promise a boolean, but not every implementation supplies one.
    target.isContentEditable === true
  );
};

export const isUndo = (event: KeyboardEvent): boolean =>
  hasModifier(event) && !event.shiftKey && event.key.toLowerCase() === 'z';

/**
 * Redo has three spellings in the wild: Cmd+Shift+Z on macOS, Ctrl+Shift+Z on
 * Linux and Windows, and Ctrl+Y on Windows.
 */
export const isRedo = (event: KeyboardEvent): boolean => {
  if (!hasModifier(event)) return false;

  const key = event.key.toLowerCase();

  return (event.shiftKey && key === 'z') || (!event.shiftKey && key === 'y');
};

export const isCopy = (event: KeyboardEvent): boolean =>
  hasModifier(event) && !event.shiftKey && event.key.toLowerCase() === 'c';

export const isDelete = (event: KeyboardEvent): boolean =>
  event.key === 'Delete' || event.key === 'Backspace';
