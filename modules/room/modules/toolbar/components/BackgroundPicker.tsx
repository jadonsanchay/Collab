import { Monitor } from 'lucide-react';

import { useModal } from '@/modules/modal';

import BackgroundModal from '../modals/BackgroundModal';

const BackgroundPicker = () => {
  const { openModal } = useModal();

  return (
    <button
      type="button"
      className="btn-icon"
      onClick={() => openModal(<BackgroundModal />)}
    >
      <Monitor />
    </button>
  );
};

export default BackgroundPicker;
