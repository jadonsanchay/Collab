import { useCallback } from 'react';
import { create } from 'zustand';

import { CtxOptions } from '@/common/types/global';

type OptionsUpdater = CtxOptions | ((prev: CtxOptions) => CtxOptions);

type OptionsState = {
  options: CtxOptions;
  setOptions: (update: OptionsUpdater) => void;
};

const DEFAULT_OPTIONS: CtxOptions = {
  lineColor: { r: 0, g: 0, b: 0, a: 1 },
  fillColor: { r: 0, g: 0, b: 0, a: 0 },
  lineWidth: 5,
  mode: 'draw',
  shape: 'line',
  selection: null,
};

export const useOptionsStore = create<OptionsState>((set) => ({
  options: DEFAULT_OPTIONS,

  setOptions: (update) =>
    set((state) => ({
      options: typeof update === 'function' ? update(state.options) : update,
    })),
}));

export const useOptionsValue = () => useOptionsStore((state) => state.options);

export const useSetOptions = () => useOptionsStore((state) => state.setOptions);

export const useOptions = (): [CtxOptions, (update: OptionsUpdater) => void] => {
  const options = useOptionsValue();
  const setOptions = useSetOptions();

  return [options, setOptions];
};

export const useSetSelection = () => {
  const setOptions = useSetOptions();

  const setSelection = useCallback(
    (rect: { x: number; y: number; width: number; height: number }) => {
      setOptions((prev) => ({ ...prev, selection: rect }));
    },
    [setOptions],
  );

  const clearSelection = useCallback(() => {
    setOptions((prev) => ({ ...prev, selection: null }));
  }, [setOptions]);

  return { setSelection, clearSelection };
};
