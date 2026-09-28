import { RgbaColorPicker } from 'react-colorful';
import { Palette } from 'lucide-react';

import HotkeyTooltip from '@/common/components/HotkeyTooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/common/components/ui/popover';
import { useOptions } from '@/common/store/options.store';

const ColorPicker = () => {
  const [options, setOptions] = useOptions();

  return (
    <Popover>
      <HotkeyTooltip label="Color">
        <PopoverTrigger asChild>
          <button
            type="button"
            className="btn-icon"
            aria-label="Color"
            disabled={options.mode === 'select'}
          >
            <Palette />
          </button>
        </PopoverTrigger>
      </HotkeyTooltip>
      <PopoverContent className="w-auto">
        <h2 className="ml-3 font-semibold">Line color</h2>
        <RgbaColorPicker
          color={options.lineColor}
          onChange={(e) => {
            setOptions({
              ...options,
              lineColor: e,
            });
          }}
          className="mb-5"
        />
        <h2 className="ml-3 font-semibold">Fill color</h2>
        <RgbaColorPicker
          color={options.fillColor}
          onChange={(e) => {
            setOptions({
              ...options,
              fillColor: e,
            });
          }}
        />
      </PopoverContent>
    </Popover>
  );
};

export default ColorPicker;
