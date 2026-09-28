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

export const isZoomIn = (event: KeyboardEvent): boolean =>
  hasModifier(event) && event.key === '=';

export const isZoomOut = (event: KeyboardEvent): boolean =>
  hasModifier(event) && event.key === '-';

export const isZoomReset = (event: KeyboardEvent): boolean =>
  hasModifier(event) && event.key === '0';

export const isFitBoard = (event: KeyboardEvent): boolean =>
  event.shiftKey && event.key === '1';

/**
 * Single-letter tool shortcuts. Never modifier-gated: a bare letter, guarded
 * only by `isTypingTarget` in the listener that uses this, same as every
 * other shortcut here.
 */
const toolKey = (key: string) => (event: KeyboardEvent): boolean =>
  !hasModifier(event) && !event.shiftKey && event.key.toLowerCase() === key;

export const isSelectTool = toolKey('v');
export const isHandTool = toolKey('h');
export const isPenTool = toolKey('p');
export const isEraserTool = toolKey('e');
export const isRectTool = toolKey('r');
export const isCircleTool = toolKey('o');
export const isLineTool = toolKey('l');
export const isImageTool = toolKey('i');

export const isWidthDecrease = (event: KeyboardEvent): boolean =>
  !hasModifier(event) && event.key === '[';

export const isWidthIncrease = (event: KeyboardEvent): boolean =>
  !hasModifier(event) && event.key === ']';

export const isCommandPalette = (event: KeyboardEvent): boolean =>
  hasModifier(event) && event.key.toLowerCase() === 'k';

/** `?` is Shift+/ on every layout that has a dedicated `?` key. */
export const isShortcutsSheet = (event: KeyboardEvent): boolean =>
  !hasModifier(event) && event.key === '?';

export const isEscape = (event: KeyboardEvent): boolean =>
  event.key === 'Escape';
