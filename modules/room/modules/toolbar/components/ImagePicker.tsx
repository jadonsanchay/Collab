import { Image as ImageIcon } from 'lucide-react';

import HotkeyTooltip from '@/common/components/HotkeyTooltip';

const ImagePicker = ({ onOpen }: { onOpen: () => void }) => (
  <HotkeyTooltip label="Image" hotkey="I">
    <button type="button" className="btn-icon" aria-label="Image" onClick={onOpen}>
      <ImageIcon />
    </button>
  </HotkeyTooltip>
);

export default ImagePicker;
