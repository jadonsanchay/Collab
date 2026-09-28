import { useRouter } from 'next/router';

import { CANVAS_SIZE } from '@/common/constants/canvasSize';
import { useModal } from '@/modules/modal';

import { useRefs } from '../../../hooks/useRefs';
import ShareModal from '../modals/ShareModal';
import { useImageInput } from './useImageInput';

/**
 * Every action the toolbar exposes, shared with the command palette so
 * neither has its own copy of the logic (or, for the image picker's paste
 * listener, a second mounted instance of it).
 */
export const useToolbarActions = () => {
  const { canvasRef, bgRef } = useRefs();
  const { openModal } = useModal();
  const router = useRouter();
  const { openImageInput } = useImageInput();

  const handleExit = () => router.push('/');

  const handleDownload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_SIZE.width;
    canvas.height = CANVAS_SIZE.height;

    const tempCtx = canvas.getContext('2d');

    if (tempCtx && canvasRef.current && bgRef.current) {
      tempCtx.drawImage(bgRef.current, 0, 0);
      tempCtx.drawImage(canvasRef.current, 0, 0);
    }

    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = 'canvas.png';
    link.click();
  };

  const handleShare = () => openModal(<ShareModal />);

  return { handleExit, handleDownload, handleShare, openImageInput };
};
