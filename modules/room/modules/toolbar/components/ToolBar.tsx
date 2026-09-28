import { Menu, Move } from 'lucide-react';

import HotkeyTooltip from '@/common/components/HotkeyTooltip';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/common/components/ui/sheet';
import { useViewportSize } from '@/common/hooks/useViewportSize';
import { useViewportStore } from '@/common/store/viewport.store';

import { useToolbarActionsContext } from '../context/ToolbarActions.context';
import { useToolHotkeys } from '../hooks/useToolHotkeys';
import HistoryBtns from './HistoryBtns';
import BackgroundPicker from './BackgroundPicker';
import ColorPicker from './ColorPicker';
import ImagePicker from './ImagePicker';
import LineWidthPicker from './LineWidthPicker';
import ModePicker from './ModePicker';
import ShapeSelector from './ShapeSelector';

const HandToolToggle = () => {
  const handTool = useViewportStore((state) => state.handTool);
  const setHandTool = useViewportStore((state) => state.setHandTool);

  return (
    <HotkeyTooltip label="Hand tool" hotkey="H">
      <button
        type="button"
        aria-label="Hand tool"
        aria-pressed={handTool}
        className={`btn-icon ${handTool ? 'bg-green-400 text-black' : ''}`}
        onClick={() => setHandTool((prev) => !prev)}
      >
        <Move />
      </button>
    </HotkeyTooltip>
  );
};

const ToolButtons = () => {
  const { openImageInput } = useToolbarActionsContext();

  return (
    <>
      <ModePicker />
      <HandToolToggle />

      <div className="h-6 w-px bg-white/20" />

      <ShapeSelector />

      <div className="h-6 w-px bg-white/20" />

      <ColorPicker />
      <LineWidthPicker />
      <ImagePicker onOpen={openImageInput} />
      <BackgroundPicker />
    </>
  );
};

const MOBILE_BREAKPOINT = 768;

/**
 * The bottom-center tool cluster. Undo/redo live at bottom-left and zoom
 * controls at bottom-right (both rendered by Canvas.tsx / ZoomControls),
 * so this component owns only the tool-switching row plus the two
 * per-stroke settings (color, width). Below the mobile breakpoint it
 * collapses into a bottom Sheet instead of a fixed bar.
 */
const Toolbar = () => {
  const { openImageInput } = useToolbarActionsContext();
  const { width } = useViewportSize();

  useToolHotkeys({ onOpenImageInput: openImageInput });

  if (width && width < MOBILE_BREAKPOINT) {
    return (
      <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3">
        <div className="flex items-center gap-1 rounded-xl bg-zinc-900 p-2 text-white">
          <HistoryBtns />
        </div>

        <Sheet>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label="Open tools"
              className="btn-icon rounded-xl bg-zinc-900 p-2 text-white"
            >
              <Menu />
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className="pb-8">
            <SheetTitle>Tools</SheetTitle>
            <div
              role="toolbar"
              aria-label="Drawing tools"
              className="mt-4 flex flex-wrap items-center gap-1"
            >
              <ToolButtons />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  return (
    <div
      role="toolbar"
      aria-label="Drawing tools"
      className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-xl bg-zinc-900 p-2 text-white"
    >
      <div className="absolute -left-24 bottom-0 flex items-center gap-1">
        <HistoryBtns />
      </div>

      <ToolButtons />
    </div>
  );
};

export default Toolbar;
