import { v4 } from 'uuid';

import { DEFAULT_MOVE } from '@/common/constants/defaultMove';
import { socket } from '@/common/lib/socket';
import { lineWidthToFontSize } from '@/common/render/text';
import { MAX_TEXT_LENGTH } from '@/common/schemas/move';
import { useDrawingStore } from '@/common/store/drawing.store';
import { useHistoryStore } from '@/common/store/history.store';
import { useOptionsStore } from '@/common/store/options.store';
import { Move } from '@/common/types/global';

/**
 * The text tool's state machine, kept outside React so both the pointer
 * handler in `useDraw` and the `TextInput` component drive the same editor.
 *
 * Only one text box is ever open. Placing a new one commits whatever the
 * previous one held, which is why `commitTextInput` runs before
 * `openTextInput` on pointer-down: the blur that follows the click then finds
 * the new, empty box and leaves it alone.
 */
export const openTextInput = (x: number, y: number) => {
  useDrawingStore.setState({ textInput: { x, y, value: '' } });
};

export const closeTextInput = () => {
  useDrawingStore.setState({ textInput: null });
};

export const updateTextInput = (value: string) => {
  const { textInput } = useDrawingStore.getState();

  if (!textInput) return;

  useDrawingStore.setState({ textInput: { ...textInput, value } });
};

/**
 * Turns the open text box into a `text` move and sends it. A box with only
 * whitespace is discarded rather than stored as an invisible move. Returns
 * true when a move was sent.
 */
export const commitTextInput = (): boolean => {
  const { textInput } = useDrawingStore.getState();

  if (!textInput) return false;

  const content = textInput.value.replace(/\s+$/u, '').slice(0, MAX_TEXT_LENGTH);

  closeTextInput();

  if (!content.trim()) return false;

  const { options } = useOptionsStore.getState();

  const move: Move = {
    ...DEFAULT_MOVE,
    // Identifies this move across a resend, so a retry is recognised by the
    // server instead of drawn twice.
    clientId: v4(),
    path: [[textInput.x, textInput.y]],
    text: { content, fontSize: lineWidthToFontSize(options.lineWidth) },
    options: { ...options, shape: 'text', mode: 'draw', selection: null },
  };

  socket.emit('draw', move);
  // A new move ends the redo chain, same as any other drawing action.
  useHistoryStore.getState().clearSavedMoves();

  return true;
};
