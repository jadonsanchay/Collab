import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Portal from '@/common/components/portal/components/Portal';
import { DEFAULT_EASE } from '@/common/constants/easings';
import {
  bgAnimation,
  modalAnimation,
} from '../animations/ModalManager.animations';
import { useModalStore } from '../store/modal.store';

const ModalManager = () => {
  const opened = useModalStore((state) => state.opened);
  const modal = useModalStore((state) => state.modal);
  const closeModal = useModalStore((state) => state.closeModal);
  const [portalNode, setPortalNode] = useState<HTMLElement>();

  useEffect(() => {
    if (!portalNode) {
      const node = document.getElementById('portal');
      if (node) setPortalNode(node);
      return;
    }

    if (opened) {
      portalNode.style.pointerEvents = 'all';
    } else {
      portalNode.style.pointerEvents = 'none';
    }
  }, [opened, portalNode]);

  return (
    <Portal>
      <motion.div
        className="absolute z-40 flex min-h-full w-full items-center justify-center bg-black/80"
        onClick={closeModal}
        variants={bgAnimation}
        initial="closed"
        animate={opened ? 'opened' : 'closed'}
        transition={{ ease: DEFAULT_EASE }} // Use the valid easing value here
      >
        <AnimatePresence>
          {opened && (
            <motion.div
              variants={modalAnimation}
              initial="closed"
              animate="opened"
              exit="exited"
              onClick={(e) => e.stopPropagation()}
              className="p-6"
              transition={{ ease: DEFAULT_EASE }} // Use the valid easing value here
            >
              {modal}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </Portal>
  );
};

export default ModalManager;
