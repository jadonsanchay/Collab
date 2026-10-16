import {
  ArrowRight,
  BringToFront,
  Circle,
  Copy,
  Eraser,
  FileDown,
  Frame,
  Hand,
  Minus,
  MousePointer2,
  Pencil,
  Redo2,
  SendToBack,
  Spline,
  Square,
  StickyNote,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import { HexColorPicker } from 'react-colorful';

import HotkeyTooltip from '@/common/components/HotkeyTooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/common/components/ui/popover';
import { Slider } from '@/common/components/ui/slider';
import { useRoom } from '@/common/store/room.store';
import { isLocked, useVectorStore, type VectorTool } from '@/common/store/vector.store';
import { createObject, deleteObjects, updateObject } from '@/common/vector/doc';
import { duplicateObject } from '@/common/vector/objects';
import { bottomZ, topZ } from '@/common/vector/order';
import SketchPopover from '@/modules/room/modules/toolbar/components/SketchPopover';

import type { VectorSession } from '../lib/session';
import { downloadSvg } from '../lib/svg';

const TOOLS: { tool: VectorTool; label: string; hotkey: string; icon: typeof Pencil }[] = [
  { tool: 'select', label: 'Select', hotkey: 'V', icon: MousePointer2 },
  { tool: 'hand', label: 'Hand (pan the board)', hotkey: 'H', icon: Hand },
  { tool: 'pen', label: 'Pen', hotkey: 'P', icon: Pencil },
  { tool: 'eraser', label: 'Eraser', hotkey: 'E', icon: Eraser },
  { tool: 'rect', label: 'Rectangle', hotkey: 'R', icon: Square },
  { tool: 'ellipse', label: 'Ellipse', hotkey: 'O', icon: Circle },
  { tool: 'line', label: 'Line', hotkey: 'L', icon: Minus },
  { tool: 'arrow', label: 'Arrow', hotkey: 'A', icon: ArrowRight },
  { tool: 'text', label: 'Text', hotkey: 'T', icon: Type },
  { tool: 'sticky', label: 'Sticky note', hotkey: 'S', icon: StickyNote },
  { tool: 'connector', label: 'Connector', hotkey: 'C', icon: Spline },
  { tool: 'frame', label: 'Frame', hotkey: 'F', icon: Frame },
];

/**
 * The vector board's tool cluster: tools, colour, width, fill, and the
 * selection commands. Disabled for viewers, who can still pan and select.
 */
const VectorToolbar = ({ session }: { session: VectorSession | null }) => {
  const tool = useVectorStore((state) => state.tool);
  const setTool = useVectorStore((state) => state.setTool);
  const color = useVectorStore((state) => state.color);
  const setColor = useVectorStore((state) => state.setColor);
  const fill = useVectorStore((state) => state.fill);
  const setFill = useVectorStore((state) => state.setFill);
  const strokeWidth = useVectorStore((state) => state.strokeWidth);
  const setStrokeWidth = useVectorStore((state) => state.setStrokeWidth);
  const selection = useVectorStore((state) => state.selection);
  const objects = useVectorStore((state) => state.objects);
  const readOnly = useVectorStore(isLocked);
  const setSelection = useVectorStore((state) => state.setSelection);
  const { id: roomId } = useRoom();

  const selected = objects.filter((object) => selection.has(object.id));
  const hasSelection = selected.length > 0 && !readOnly;

  const withDoc = (action: (doc: NonNullable<typeof session>['doc']) => void) => {
    if (!session || readOnly) return;

    session.undo.stopCapturing();
    session.doc.transact(() => action(session.doc), session.origin);
  };

  return (
    <div
      role="toolbar"
      aria-label="Vector tools"
      className="fixed left-1/2 top-16 z-40 flex -translate-x-1/2 items-center gap-1 rounded-xl bg-zinc-900 p-2 text-white shadow-lg"
    >
      <div className="absolute -left-28 top-0 flex items-center gap-1 rounded-xl bg-zinc-900 p-2 shadow-lg">
        <HotkeyTooltip label="Undo" hotkey="⌘Z">
          <button
            type="button"
            className="btn-icon"
            aria-label="Undo"
            disabled={readOnly || !session?.undo.canUndo()}
            onClick={() => session?.undo.undo()}
          >
            <Undo2 />
          </button>
        </HotkeyTooltip>
        <HotkeyTooltip label="Redo" hotkey="⌘⇧Z">
          <button
            type="button"
            className="btn-icon"
            aria-label="Redo"
            disabled={readOnly || !session?.undo.canRedo()}
            onClick={() => session?.undo.redo()}
          >
            <Redo2 />
          </button>
        </HotkeyTooltip>
      </div>

      {TOOLS.map(({ tool: candidate, label, hotkey, icon: Icon }) => (
        <HotkeyTooltip key={candidate} label={label} hotkey={hotkey}>
          <button
            type="button"
            role="radio"
            aria-label={label}
            aria-checked={tool === candidate}
            className={`btn-icon ${tool === candidate ? 'bg-green-400 text-black' : ''}`}
            disabled={readOnly && candidate !== 'select' && candidate !== 'hand'}
            onClick={() => setTool(candidate)}
          >
            <Icon />
          </button>
        </HotkeyTooltip>
      ))}

      <div className="h-6 w-px bg-white/20" />

      <Popover>
        <HotkeyTooltip label="Colour">
          <PopoverTrigger asChild>
            <button type="button" className="btn-icon" aria-label="Colour" disabled={readOnly}>
              <span className="size-5 rounded-full border border-white/40" style={{ backgroundColor: color }} />
            </button>
          </PopoverTrigger>
        </HotkeyTooltip>
        <PopoverContent className="w-auto">
          <HexColorPicker color={color} onChange={setColor} />
          <label htmlFor="vector-fill-shapes" className="mt-2 flex items-center gap-2 text-xs">
            <input
              id="vector-fill-shapes"
              type="checkbox"
              checked={fill !== null}
              onChange={(event) => setFill(event.target.checked ? `${color}33` : null)}
            />
            Fill shapes
          </label>
        </PopoverContent>
      </Popover>

      <Popover>
        <HotkeyTooltip label="Stroke width">
          <PopoverTrigger asChild>
            <button type="button" className="btn-icon" aria-label="Stroke width" disabled={readOnly}>
              <span className="rounded-full bg-white" style={{ width: 4 + strokeWidth, height: 4 + strokeWidth }} />
            </button>
          </PopoverTrigger>
        </HotkeyTooltip>
        <PopoverContent className="w-48">
          <Slider min={1} max={24} step={1} value={[strokeWidth]} onValueChange={([value]) => setStrokeWidth(value)} />
        </PopoverContent>
      </Popover>

      <div className="h-6 w-px bg-white/20" />

      <HotkeyTooltip label="Duplicate" hotkey="⌘D">
        <button
          type="button"
          className="btn-icon"
          aria-label="Duplicate"
          disabled={!hasSelection}
          onClick={() =>
            withDoc((doc) => {
              const copies = selected.map((object) => duplicateObject(object, topZ(objects)));
              copies.forEach((copy) => createObject(doc, copy));
              setSelection(copies.map((copy) => copy.id));
            })
          }
        >
          <Copy />
        </button>
      </HotkeyTooltip>
      <HotkeyTooltip label="Bring to front" hotkey="⌘⇧]">
        <button
          type="button"
          className="btn-icon"
          aria-label="Bring to front"
          disabled={!hasSelection}
          onClick={() => withDoc((doc) => selected.forEach((object) => updateObject(doc, object.id, { z: topZ(objects) })))}
        >
          <BringToFront />
        </button>
      </HotkeyTooltip>
      <HotkeyTooltip label="Send to back" hotkey="⌘⇧[">
        <button
          type="button"
          className="btn-icon"
          aria-label="Send to back"
          disabled={!hasSelection}
          onClick={() => withDoc((doc) => selected.forEach((object) => updateObject(doc, object.id, { z: bottomZ(objects) })))}
        >
          <SendToBack />
        </button>
      </HotkeyTooltip>
      <HotkeyTooltip label="Delete" hotkey="Del">
        <button
          type="button"
          className="btn-icon"
          aria-label="Delete selection"
          disabled={!hasSelection}
          onClick={() =>
            withDoc((doc) => {
              deleteObjects(doc, selected.filter((object) => !object.locked).map((object) => object.id));
              setSelection([]);
            })
          }
        >
          <Trash2 />
        </button>
      </HotkeyTooltip>

      <div className="h-6 w-px bg-white/20" />

      <SketchPopover />
      <HotkeyTooltip label="Export SVG">
        <button
          type="button"
          className="btn-icon"
          aria-label="Export SVG"
          disabled={!objects.length}
          onClick={() => downloadSvg(objects, `collab-${roomId}.svg`)}
        >
          <FileDown />
        </button>
      </HotkeyTooltip>
    </div>
  );
};

export default VectorToolbar;
