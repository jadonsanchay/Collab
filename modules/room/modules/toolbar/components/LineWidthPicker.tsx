import { SlidersHorizontal } from 'lucide-react';

import HotkeyTooltip from '@/common/components/HotkeyTooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/common/components/ui/popover';
import { Slider } from '@/common/components/ui/slider';
import { useOptions } from '@/common/store/options.store';

const MIN_WIDTH = 1;
const MAX_WIDTH = 20;

const LineWidthPicker = () => {
  const [options, setOptions] = useOptions();

  const setWidth = (width: number) =>
    setOptions((prev) => ({
      ...prev,
      lineWidth: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)),
    }));

  return (
    <Popover>
      <HotkeyTooltip label="Line width" hotkey="[ ]">
        <PopoverTrigger asChild>
          <button
            type="button"
            className="btn-icon"
            aria-label="Line width"
            disabled={options.mode === 'select'}
          >
            <SlidersHorizontal />
          </button>
        </PopoverTrigger>
      </HotkeyTooltip>
      <PopoverContent className="w-48">
        <Slider
          min={MIN_WIDTH}
          max={MAX_WIDTH}
          step={1}
          value={[options.lineWidth]}
          onValueChange={([value]) => setWidth(value)}
        />
      </PopoverContent>
    </Popover>
  );
};

export default LineWidthPicker;
