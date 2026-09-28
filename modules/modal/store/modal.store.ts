import { JSX } from 'react';
import { create } from 'zustand';

type ModalState = {
  modal: JSX.Element | JSX.Element[] | null;
  opened: boolean;
  openModal: (modal: JSX.Element | JSX.Element[]) => void;
  closeModal: () => void;
};

export const useModalStore = create<ModalState>((set) => ({
  modal: null,
  opened: false,

  openModal: (modal) => set({ modal, opened: true }),

  closeModal: () => set({ modal: null, opened: false }),
}));

const useModal = () => {
  const openModal = useModalStore((state) => state.openModal);
  const closeModal = useModalStore((state) => state.closeModal);

  return { openModal, closeModal };
};

export { useModal };
