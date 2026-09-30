export type BackgroundSetting = { mode: 'dark' | 'light'; lines: boolean };

export const GRID_STEP = 25;

/**
 * The board background: a flat colour and, optionally, a 25 px grid. Shared
 * by the client's background layer and the server-side thumbnail renderer,
 * so a thumbnail looks like the board it stands for.
 */
export const drawBackground = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  background: BackgroundSetting,
) => {
  ctx.fillStyle = background.mode === 'dark' ? '#222' : '#fff';
  ctx.fillRect(0, 0, width, height);

  if (!background.lines) return;

  ctx.lineWidth = 1;
  ctx.strokeStyle = background.mode === 'dark' ? '#444' : '#ddd';

  for (let y = 0; y < height; y += GRID_STEP) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  for (let x = 0; x < width; x += GRID_STEP) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
};
