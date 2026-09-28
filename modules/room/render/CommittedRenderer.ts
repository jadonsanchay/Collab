import { drawMove, preloadImages } from '@/common/render/drawMove';
import { Move } from '@/common/types/global';

const CHECKPOINT_OFFSET = 30;

type Checkpoint = { seqs: number[]; bitmap: ImageBitmap };

type Snapshot = (canvas: HTMLCanvasElement) => Promise<ImageBitmap>;

const defaultSnapshot: Snapshot = (canvas) => createImageBitmap(canvas);

type Draw = (
  ctx: CanvasRenderingContext2D,
  move: Move,
  cache: Map<string, HTMLImageElement>,
) => void;

/**
 * Owns the committed canvas: an image cache so replays never re-decode a
 * base64 payload twice, a checkpoint bitmap so undo/redo on a large board
 * doesn't replay every move from scratch, and rAF-coalesced scheduling so
 * several state changes in one frame produce a single render.
 */
export class CommittedRenderer {
  private imageCache = new Map<string, HTMLImageElement>();

  private checkpoint: Checkpoint | null = null;

  private pendingMoves: Move[] | null = null;

  private frameScheduled = false;

  private rendering = false;

  constructor(
    private ctx: CanvasRenderingContext2D,
    private onRendered?: () => void,
    private snapshot: Snapshot = defaultSnapshot,
    private draw: Draw = drawMove,
  ) {}

  schedule(moves: Move[]) {
    this.pendingMoves = moves;

    if (this.frameScheduled) return;

    // Set before requesting the frame, not from the return value: a
    // synchronous rAF polyfill would otherwise run the callback (which
    // clears this flag) before `requestAnimationFrame` itself returns,
    // and assigning its return value afterwards would clobber that clear.
    this.frameScheduled = true;

    requestAnimationFrame(() => {
      this.frameScheduled = false;

      const next = this.pendingMoves;
      this.pendingMoves = null;

      if (next) this.render(next);
    });
  }

  private isCheckpointValid(moves: Move[]) {
    if (!this.checkpoint) return false;
    if (moves.length < this.checkpoint.seqs.length) return false;

    return this.checkpoint.seqs.every((seq, i) => moves[i]?.seq === seq);
  }

  private async render(moves: Move[]) {
    if (this.rendering) {
      this.pendingMoves = moves;
      return;
    }

    this.rendering = true;

    try {
      if (this.checkpoint && this.isCheckpointValid(moves)) {
        await this.replayFromCheckpoint(moves, this.checkpoint);
      } else {
        await this.fullReplay(moves);
      }
    } finally {
      this.rendering = false;
      this.onRendered?.();

      if (this.pendingMoves) {
        const next = this.pendingMoves;
        this.pendingMoves = null;
        this.render(next);
      }
    }
  }

  private async replayFromCheckpoint(moves: Move[], checkpoint: Checkpoint) {
    const tail = moves.slice(checkpoint.seqs.length);

    await preloadImages(tail, this.imageCache);

    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    this.ctx.drawImage(checkpoint.bitmap, 0, 0);

    tail.forEach((move) => this.draw(this.ctx, move, this.imageCache));
  }

  private async fullReplay(moves: Move[]) {
    await preloadImages(moves, this.imageCache);

    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);

    const cutoff = Math.max(0, moves.length - CHECKPOINT_OFFSET);
    const head = moves.slice(0, cutoff);

    head.forEach((move) => this.draw(this.ctx, move, this.imageCache));

    if (cutoff > 0) {
      const bitmap = await this.snapshot(this.ctx.canvas);

      this.checkpoint = { seqs: head.map((move) => move.seq), bitmap };
    } else {
      this.checkpoint = null;
    }

    moves
      .slice(cutoff)
      .forEach((move) => this.draw(this.ctx, move, this.imageCache));
  }
}
