// @vitest-environment jsdom
// The matchers check `instanceof HTMLElement`, so this file needs real DOM
// constructors. Everything else in the suite stays on the faster node env.
import { describe, expect, it } from 'vitest';

import { isCopy, isDelete, isRedo, isTypingTarget, isUndo } from './keyboard';

/** Minimal stand-in for the fields the matchers read. */
const key = (
  k: string,
  modifiers: { meta?: boolean; ctrl?: boolean; shift?: boolean } = {},
) =>
  ({
    key: k,
    metaKey: modifiers.meta ?? false,
    ctrlKey: modifiers.ctrl ?? false,
    shiftKey: modifiers.shift ?? false,
  }) as KeyboardEvent;

describe('isUndo', () => {
  it('accepts Cmd+Z, which is what macOS sends', () => {
    expect(isUndo(key('z', { meta: true }))).toBe(true);
  });

  it('accepts Ctrl+Z', () => {
    expect(isUndo(key('z', { ctrl: true }))).toBe(true);
  });

  it('accepts an uppercase key, as sent with caps lock on', () => {
    expect(isUndo(key('Z', { ctrl: true }))).toBe(true);
  });

  it('rejects Z with no modifier, which is just typing', () => {
    expect(isUndo(key('z'))).toBe(false);
  });

  it('rejects Cmd+Shift+Z, which is redo', () => {
    expect(isUndo(key('z', { meta: true, shift: true }))).toBe(false);
  });
});

describe('isRedo', () => {
  it.each([
    ['Cmd+Shift+Z', key('z', { meta: true, shift: true })],
    ['Ctrl+Shift+Z', key('z', { ctrl: true, shift: true })],
    ['Ctrl+Y', key('y', { ctrl: true })],
    ['Cmd+Y', key('y', { meta: true })],
  ])('accepts %s', (_label, event) => {
    expect(isRedo(event)).toBe(true);
  });

  it('rejects plain Cmd+Z, which is undo', () => {
    expect(isRedo(key('z', { meta: true }))).toBe(false);
  });

  it('rejects Y with no modifier', () => {
    expect(isRedo(key('y'))).toBe(false);
  });
});

describe('isCopy', () => {
  it('accepts Cmd+C and Ctrl+C', () => {
    expect(isCopy(key('c', { meta: true }))).toBe(true);
    expect(isCopy(key('c', { ctrl: true }))).toBe(true);
  });

  it('rejects a bare C, so typing "c" does not copy the board', () => {
    expect(isCopy(key('c'))).toBe(false);
  });
});

describe('isDelete', () => {
  it('accepts Delete and Backspace', () => {
    expect(isDelete(key('Delete'))).toBe(true);
    expect(isDelete(key('Backspace'))).toBe(true);
  });

  it('rejects other keys', () => {
    expect(isDelete(key('d'))).toBe(false);
  });
});

describe('isTypingTarget', () => {
  it.each(['INPUT', 'TEXTAREA', 'SELECT'])('detects a %s', (tag) => {
    expect(isTypingTarget(document.createElement(tag))).toBe(true);
  });

  it('detects a contenteditable element', () => {
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    // jsdom does not derive isContentEditable from the attribute.
    Object.defineProperty(editable, 'isContentEditable', { value: true });

    expect(isTypingTarget(editable)).toBe(true);
  });

  it('does not treat the canvas or a null target as typing', () => {
    expect(isTypingTarget(document.createElement('canvas'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
