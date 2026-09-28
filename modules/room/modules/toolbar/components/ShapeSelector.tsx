import { Circle, RectangleHorizontal, Waves } from 'lucide-react';

import HotkeyTooltip from '@/common/components/HotkeyTooltip';
import { ToggleGroup, ToggleGroupItem } from '@/common/components/ui/toggle-group';
import { useOptions } from '@/common/store/options.store';
import { Shape } from '@/common/types/global';

const ShapeSelector = () => {
  const [options, setOptions] = useOptions();

  const setShape = (shape: string) => {
    if (!shape) return;

    setOptions((prev) => ({ ...prev, shape: shape as Shape }));
  };

  return (
    <ToggleGroup
      type="single"
      value={options.shape}
      onValueChange={setShape}
      aria-disabled={options.mode !== 'draw'}
    >
      <HotkeyTooltip label="Line" hotkey="L">
        <ToggleGroupItem
          value="line"
          aria-label="Line"
          disabled={options.mode !== 'draw'}
        >
          <Waves />
        </ToggleGroupItem>
      </HotkeyTooltip>

      <HotkeyTooltip label="Rectangle" hotkey="R">
        <ToggleGroupItem
          value="rect"
          aria-label="Rectangle"
          disabled={options.mode !== 'draw'}
        >
          <RectangleHorizontal />
        </ToggleGroupItem>
      </HotkeyTooltip>

      <HotkeyTooltip label="Circle" hotkey="O">
        <ToggleGroupItem
          value="circle"
          aria-label="Circle"
          disabled={options.mode !== 'draw'}
        >
          <Circle />
        </ToggleGroupItem>
      </HotkeyTooltip>
    </ToggleGroup>
  );
};

export default ShapeSelector;
