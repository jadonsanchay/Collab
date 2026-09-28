import { useEffect } from 'react';

import { optimizeImage } from '@/common/lib/optimizeImage';

import { useMoveImage } from '../../../hooks/useMoveImage';

/**
 * Shared between `ImagePicker`'s button and the `I` hotkey: both need the
 * same paste listener and file-picker trigger.
 */
export const useImageInput = () => {
  const { setMoveImage } = useMoveImage();

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (items) {
        Array.from(items).forEach((item) => {
          if (item.type.includes('image')) {
            const file = item.getAsFile();
            if (file)
              optimizeImage(file, (uri) => setMoveImage({ base64: uri }));
          }
        });
      }
    };

    document.addEventListener('paste', handlePaste);

    return () => {
      document.removeEventListener('paste', handlePaste);
    };
  }, [setMoveImage]);

  const openImageInput = () => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.click();

    fileInput.addEventListener('change', () => {
      if (fileInput && fileInput.files) {
        const file = fileInput.files[0];
        optimizeImage(file, (uri) => setMoveImage({ base64: uri }));
      }
    });
  };

  return { openImageInput };
};
