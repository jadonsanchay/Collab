import { useEffect } from 'react';

import { Eraser, MousePointer2, Pencil } from 'lucide-react';

import { useOptions, useSetSelection } from '@/common/store/options.store';

const ModePicker = () => {
  const [options, setOptions] = useOptions();
  const { clearSelection } = useSetSelection();

  useEffect(() => {
    clearSelection();
  }, [options.mode, clearSelection]);

  return (
    <>
      <button
        type="button"
        className={`btn-icon text-xl ${
          options.mode === 'draw' && 'bg-green-400'
        }`}
        onClick={() => {
          setOptions((prev) => ({
            ...prev,
            mode: 'draw',
          }));
        }}
      >
        <Pencil />
      </button>

      <button
        type="button"
        className={`btn-icon text-xl ${
          options.mode === 'eraser' && 'bg-green-400'
        }`}
        onClick={() => {
          setOptions((prev) => ({
            ...prev,
            mode: 'eraser',
          }));
        }}
      >
        <Eraser />
      </button>

      <button
        type="button"
        className={`btn-icon text-2xl ${
          options.mode === 'select' && 'bg-green-400'
        }`}
        onClick={() => {
          setOptions((prev) => ({
            ...prev,
            mode: 'select',
          }));
        }}
      >
        <MousePointer2 />
      </button>
    </>
  );
};

export default ModePicker;
