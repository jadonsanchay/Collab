import { useEffect, useState } from 'react';

import { motion } from 'framer-motion';
import { useRouter } from 'next/router';
import { ChevronRight, Download, LogOut, Share2 } from 'lucide-react';

import { CANVAS_SIZE } from '@/common/constants/canvasSize';
import { useViewportSize } from '@/common/hooks/useViewportSize';
import { useModal } from '@/modules/modal';

import { useRefs } from '../../../hooks/useRefs';
import ShareModal from '../modals/ShareModal';
import BackgroundPicker from './BackgroundPicker';
import ColorPicker from './ColorPicker';
import HistoryBtns from './HistoryBtns';
import ImagePicker from './ImagePicker';
import LineWidthPicker from './LineWidthPicker';
import ModePicker from './ModePicker';
import ShapeSelector from './ShapeSelector';

const ToolBar = () => {
  const { canvasRef, bgRef } = useRefs();
  const { openModal } = useModal();
  const { width } = useViewportSize();

  const [opened, setOpened] = useState(false);

  const router = useRouter();

  useEffect(() => {
    if (width >= 1024) setOpened(true);
    else setOpened(false);
  }, [width]);

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

  return (
    <>
      <motion.button
        className="btn-icon absolute -left-2 bottom-1/2 z-50 size-10 rounded-full bg-black text-2xl transition-none lg:hidden"
        animate={{ rotate: opened ? 0 : 180 }}
        transition={{ duration: 0.2 }}
        onClick={() => setOpened(!opened)}
      >
        <ChevronRight />
      </motion.button>
      <motion.div
        className="absolute left-10 top-1/2 z-50 grid grid-cols-2 items-center gap-5 rounded-lg bg-zinc-900 p-5 text-white 2xl:grid-cols-1"
        animate={{
          x: opened ? 0 : -160,
          y: '-50%',
        }}
        transition={{
          duration: 0.2,
        }}
      >
        <HistoryBtns />

        <div className="h-px w-full bg-white 2xl:hidden" />
        <div className="h-px w-full bg-white" />

        <ShapeSelector />
        <ColorPicker />
        <LineWidthPicker />
        <ModePicker />
        <ImagePicker />

        <div className="2xl:hidden" />
        <div className="h-px w-full bg-white 2xl:hidden" />
        <div className="h-px w-full bg-white" />

        <BackgroundPicker />
        <button
          type="button"
          className="btn-icon text-2xl"
          onClick={handleShare}
        >
          <Share2 />
        </button>
        <button
          type="button"
          className="btn-icon text-2xl"
          onClick={handleDownload}
        >
          <Download />
        </button>
        <button type="button" className="btn-icon text-xl" onClick={handleExit}>
          <LogOut />
        </button>
      </motion.div>
    </>
  );
};

export default ToolBar;
