import { useHistoryStore } from '@/common/store/history.store';

/**
 * Shown while Rewind is scrubbed into the past. The board is read-only in
 * that state, and this is what says so and offers the way back.
 */
const HistoryBanner = () => {
  const cursorSeq = useHistoryStore((state) => state.view.cursorSeq);
  const goLive = useHistoryStore((state) => state.goLive);

  if (cursorSeq === null) return null;

  return (
    <div
      role="status"
      className="pointer-events-auto fixed left-1/2 top-32 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full bg-amber-500 px-4 py-1.5 text-sm font-semibold text-black shadow-lg"
    >
      <span>Viewing history</span>
      <button
        type="button"
        className="rounded-full bg-black/80 px-3 py-0.5 text-white hover:bg-black"
        onClick={goLive}
      >
        Back to live
      </button>
    </div>
  );
};

export default HistoryBanner;
