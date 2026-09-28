import { useEffect } from 'react';
import { create } from 'zustand';

type Background = { mode: 'dark' | 'light'; lines: boolean };

type BackgroundState = {
  background: Background;
  setBackground: (mode: Background['mode'], lines: boolean) => void;
};

export const useBackgroundStore = create<BackgroundState>((set) => ({
  background: { mode: 'light', lines: true },

  setBackground: (mode, lines) => set({ background: { mode, lines } }),
}));

export const useBackground = () => {
  const bg = useBackgroundStore((state) => state.background);

  useEffect(() => {
    const root = window.document.documentElement;

    if (bg.mode === 'dark') {
      root.classList.remove('light');
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
      root.classList.add('light');
    }
  }, [bg.mode]);

  return bg;
};

export const useSetBackground = () => useBackgroundStore((state) => state.setBackground);
