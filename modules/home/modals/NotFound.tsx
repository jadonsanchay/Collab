import { X } from 'lucide-react';

import { useModal } from '@/modules/modal';

const REASONS: Record<string, { title: string; hint: string }> = {
  forbidden: {
    title: 'This board is private.',
    hint: 'Ask the owner for an invitation link.',
  },
  full: {
    title: 'This board is full.',
    hint: 'Twelve people are already in it. Try again later.',
  },
};

const NotFoundModal = ({ id, reason = undefined }: { id: string; reason?: string }) => {
  const { closeModal } = useModal();
  const known = reason ? REASONS[reason] : undefined;

  return (
    <div className="relative flex flex-col items-center rounded-md bg-white p-10">
      <button
        type="button"
        onClick={closeModal}
        className="absolute right-5 top-5"
      >
        <X />
      </button>
      <h2 className="text-lg font-bold">
        {known ? known.title : `Room with id "${id}" does not exist or is full!`}
      </h2>
      <h3>{known ? known.hint : 'Try to join room later.'}</h3>
    </div>
  );
};

export default NotFoundModal;
