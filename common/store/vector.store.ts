import { create } from 'zustand';

import { type Camera, DEFAULT_CAMERA } from '@/common/vector/camera';
import type { BoardObject, ShapeKind } from '@/common/vector/types';

export type VectorTool =
  | 'select'
  | 'hand'
  | 'pen'
  | 'eraser'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'text'
  | 'sticky'
  | 'connector'
  | 'frame';

export const SHAPE_TOOLS: Record<string, ShapeKind> = {
  rect: 'rect',
  ellipse: 'ellipse',
  line: 'line',
  arrow: 'arrow',
};

export type VectorState = {
  camera: Camera;
  tool: VectorTool;
  /** Plain mirror of the document for React; the renderer reads it too. */
  objects: BoardObject[];
  selection: Set<string>;
  /** Object whose text is being edited in the overlay, if any. */
  editingId: string | null;
  color: string;
  fill: string | null;
  strokeWidth: number;
  connected: boolean;
  /** Editors and owners write; everyone else looks. From the join role. */
  readOnly: boolean;
  /**
   * What Rewind is showing instead of the live document, or null when live.
   * The renderer draws these; the tools refuse to edit while they are set.
   */
  historyObjects: BoardObject[] | null;
  setCamera: (camera: Camera) => void;
  setTool: (tool: VectorTool) => void;
  setObjects: (objects: BoardObject[]) => void;
  setSelection: (ids: Iterable<string>) => void;
  setEditingId: (id: string | null) => void;
  setColor: (color: string) => void;
  setFill: (fill: string | null) => void;
  setStrokeWidth: (width: number) => void;
  setConnected: (connected: boolean) => void;
  setReadOnly: (readOnly: boolean) => void;
  setHistoryObjects: (objects: BoardObject[] | null) => void;
  reset: () => void;
};

const INITIAL = {
  camera: DEFAULT_CAMERA,
  tool: 'select' as VectorTool,
  objects: [] as BoardObject[],
  selection: new Set<string>(),
  editingId: null,
  color: '#1F2937',
  fill: null,
  strokeWidth: 4,
  connected: false,
  readOnly: false,
  historyObjects: null as BoardObject[] | null,
};

/**
 * Client state for a vector board. Reactive reads use the hook; the pointer
 * handlers read and write through `getState`/`setState` so a drag never
 * re-renders React per event. The document itself lives in the Yjs doc
 * (`modules/vector/lib/session.ts`); `objects` mirrors it after each change.
 */
export const useVectorStore = create<VectorState>((set) => ({
  ...INITIAL,

  setCamera: (camera) => set({ camera }),
  setTool: (tool) => set({ tool, editingId: null }),
  setObjects: (objects) => set({ objects }),
  setSelection: (ids) => set({ selection: new Set(ids) }),
  setEditingId: (editingId) => set({ editingId }),
  setColor: (color) => set({ color }),
  setFill: (fill) => set({ fill }),
  setStrokeWidth: (strokeWidth) => set({ strokeWidth }),
  setConnected: (connected) => set({ connected }),
  setReadOnly: (readOnly) => set({ readOnly }),
  setHistoryObjects: (historyObjects) => set({ historyObjects }),
  reset: () => set({ ...INITIAL, selection: new Set() }),
}));

/** The objects on screen: the past while Rewind is scrubbed, else the live document. */
export const visibleObjects = (state: VectorState) => state.historyObjects ?? state.objects;

/** True while Rewind shows the past, or the role forbids writing. */
export const isLocked = (state: VectorState) => state.readOnly || state.historyObjects !== null;
