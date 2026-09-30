import { useEffect, useRef, useState } from 'react';

import type * as Y from 'yjs';

import { fontFor, LINE_HEIGHT } from '@/common/render/vector/text';
import { worldToScreen } from '@/common/vector/camera';
import { textOf, updateObject } from '@/common/vector/doc';
import { useVectorStore } from '@/common/store/vector.store';

import type { VectorSession } from '../lib/session';

/** Applies a textarea change to a Y.Text as the smallest insert/delete pair. */
const applyDiff = (text: Y.Text, previous: string, next: string, origin: unknown) => {
  if (previous === next) return;

  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start += 1;

  let endPrevious = previous.length;
  let endNext = next.length;
  while (endPrevious > start && endNext > start && previous[endPrevious - 1] === next[endNext - 1]) {
    endPrevious -= 1;
    endNext -= 1;
  }

  text.doc?.transact(() => {
    if (endPrevious > start) text.delete(start, endPrevious - start);
    if (endNext > start) text.insert(start, next.slice(start, endNext));
  }, origin);
};

/**
 * In-place text editing: a textarea positioned over the object in screen
 * space, bound to the object's `Y.Text` so two people can type in the same
 * sticky and both keep their text. Local keystrokes become minimal Yjs
 * operations; remote changes update the textarea without stealing the
 * caret more than the change itself moves it.
 */
/** Which text field the editor binds to, per object type. */
const FIELD_BY_TYPE: Record<string, 'text' | 'title' | 'label'> = {
  frame: 'title',
  connector: 'label',
};

const TextEditorOverlay = ({ session }: { session: VectorSession }) => {
  const editingId = useVectorStore((state) => state.editingId);
  const camera = useVectorStore((state) => state.camera);
  const object = useVectorStore((state) => state.objects.find((o) => o.id === state.editingId));
  const setEditingId = useVectorStore((state) => state.setEditingId);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState('');

  const field = FIELD_BY_TYPE[object?.type ?? ''] ?? 'text';
  const ytext = editingId ? textOf(session.doc, editingId, field) : null;

  useEffect(() => {
    if (!ytext) return undefined;

    // Typing merges into one undo step; opening the editor starts a new one.
    session.undo.stopCapturing();
    setValue(ytext.toString());

    const onChange = (_event: Y.YTextEvent, transaction: Y.Transaction) => {
      if (transaction.origin === session.origin) return;

      const element = ref.current;
      const caret = element?.selectionStart ?? 0;
      const next = ytext.toString();

      setValue(next);
      requestAnimationFrame(() => element?.setSelectionRange(caret, caret));
    };

    ytext.observe(onChange);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(ref.current.value.length, ref.current.value.length);
    });

    return () => ytext.unobserve(onChange);
  }, [ytext, session]);

  if (!object || !ytext || !editingId) return null;

  const screen = worldToScreen({ x: object.x, y: object.y }, camera);
  const fontSize = (object.type === 'text' || object.type === 'sticky' ? object.fontSize : 16) * camera.zoom;
  const padding = object.type === 'sticky' ? 14 * camera.zoom : 0;

  const finish = () => {
    // Text objects grow to fit what was typed.
    if (object.type === 'text') {
      const lines = Math.max(1, value.split('\n').length);
      updateObject(session.doc, object.id, { h: Math.max(object.h, lines * object.fontSize * LINE_HEIGHT) }, session.origin);
    }

    setEditingId(null);
  };

  return (
    <textarea
      ref={ref}
      aria-label="Edit text"
      className="absolute z-30 resize-none overflow-hidden bg-transparent p-0 outline-none ring-2 ring-blue-500"
      style={{
        left: screen.x + padding,
        top: screen.y + padding,
        width: Math.max(40, object.w * camera.zoom - padding * 2),
        height: Math.max(fontSize * LINE_HEIGHT, object.h * camera.zoom - padding * 2),
        font: fontFor(fontSize),
        lineHeight: LINE_HEIGHT,
        color: object.type === 'text' ? object.color : '#1F2937',
        transform: object.rotation ? `rotate(${object.rotation}deg)` : undefined,
        transformOrigin: 'center',
      }}
      value={value}
      onChange={(event) => {
        applyDiff(ytext, value, event.target.value, session.origin);
        setValue(event.target.value);
      }}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          finish();
        }

        if (event.key === 'Enter' && !event.shiftKey && object.type !== 'sticky' && object.type !== 'text') {
          event.preventDefault();
          finish();
        }
      }}
    />
  );
};

export default TextEditorOverlay;
