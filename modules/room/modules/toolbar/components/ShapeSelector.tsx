import { useRef, useState } from 'react';

import { motion, AnimatePresence } from 'framer-motion';
import { Circle, RectangleHorizontal, Waves } from 'lucide-react';
import { useClickAway } from 'react-use';

import { useOptions } from '@/common/store/options.store';
import { Shape } from '@/common/types/global';

import { EntryAnimation } from '../animations/Entry.animations';

const ShapeSelector = () => {
  const [options, setOptions] = useOptions();

  const ref = useRef<HTMLDivElement>(null);

  const [opened, setOpened] = useState(false);

  useClickAway(ref, () => setOpened(false));

  const handleShapeChange = (shape: Shape) => {
    setOptions((prev) => ({
      ...prev,
      shape,
    }));

    setOpened(false);
  };

  return (
    <div className="relative flex items-center" ref={ref}>
      <button
        type="button"
        className="btn-icon text-2xl"
        disabled={options.mode === 'select'}
        onClick={() => setOpened((prev) => !prev)}
      >
        {options.shape === 'circle' && <Circle />}
        {options.shape === 'rect' && <RectangleHorizontal />}
        {options.shape === 'line' && <Waves />}
      </button>

      <AnimatePresence>
        {opened && (
          <motion.div
            className="absolute left-14 z-10 flex gap-1 rounded-lg border bg-zinc-900 p-2 md:border-0"
            variants={EntryAnimation}
            initial="from"
            animate="to"
            exit="from"
          >
            <button
              type="button"
              className="btn-icon text-2xl"
              onClick={() => handleShapeChange('line')}
            >
              <Waves />
            </button>

            <button
              type="button"
              className="btn-icon text-2xl"
              onClick={() => handleShapeChange('rect')}
            >
              <RectangleHorizontal />
            </button>

            <button
              type="button"
              className="btn-icon text-2xl"
              onClick={() => handleShapeChange('circle')}
            >
              <Circle />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ShapeSelector;
