import { Monitor } from 'lucide-react';

import HotkeyTooltip from '@/common/components/HotkeyTooltip';
import { useModal } from '@/modules/modal';

import BackgroundModal from '../modals/BackgroundModal';

const BackgroundPicker = () => {
  const { openModal } = useModal();

  return (
    <HotkeyTooltip label="Background">
      <button
        type="button"
        className="btn-icon"
        aria-label="Background"
        onClick={() => openModal(<BackgroundModal />)}
      >
        <Monitor />
      </button>
    </HotkeyTooltip>
  );
};

export default BackgroundPicker;
