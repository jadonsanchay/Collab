import { JSX } from 'react';
import { atom } from 'recoil';

export const modalAtom = atom<{
  modal: JSX.Element | JSX.Element[] | null;
  opened: boolean;
}>({
  key: 'modal',
  default: {
    modal: null,
    opened: false,
  },
});
