import { useEffect } from 'react';

import { Eraser, MousePointer2, Pencil } from 'lucide-react';

import HotkeyTooltip from '@/common/components/HotkeyTooltip';
import { ToggleGroup, ToggleGroupItem } from '@/common/components/ui/toggle-group';
import { CtxMode } from '@/common/types/global';
import { useOptions, useSetSelection } from '@/common/store/options.store';

const ModePicker = () => {
  const [options, setOptions] = useOptions();
  const { clearSelection } = useSetSelection();

  useEffect(() => {
    clearSelection();
  }, [options.mode, clearSelection]);

  const setMode = (mode: string) => {
    if (!mode) return;

    setOptions((prev) => ({ ...prev, mode: mode as CtxMode }));
  };

  return (
    <ToggleGroup type="single" value={options.mode} onValueChange={setMode}>
      <HotkeyTooltip label="Pen" hotkey="P">
        <ToggleGroupItem value="draw" aria-label="Pen">
          <Pencil />
        </ToggleGroupItem>
      </HotkeyTooltip>

      <HotkeyTooltip label="Eraser" hotkey="E">
        <ToggleGroupItem value="eraser" aria-label="Eraser">
          <Eraser />
        </ToggleGroupItem>
      </HotkeyTooltip>

      <HotkeyTooltip label="Select" hotkey="V">
        <ToggleGroupItem value="select" aria-label="Select">
          <MousePointer2 />
        </ToggleGroupItem>
      </HotkeyTooltip>
    </ToggleGroup>
  );
};

export default ModePicker;
