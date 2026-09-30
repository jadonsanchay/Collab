import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CANVAS_SIZE } from '@/common/constants/canvasSize';

import { LocalStorage } from '../storage/local';
import { makeMove } from '../testing/fixtures';
import { createNodeImageLoader } from './nodeLoader';
import { encodePng, encodeWebp, renderBoard } from './renderBoard';

const black = { r: 0, g: 0, b: 0, a: 1 };

const opaqueAt = (canvas: Awaited<ReturnType<typeof renderBoard>>, x: number, y: number, half = 6) => {
  const { data } = canvas.getContext('2d').getImageData(x - half, y - half, half * 2, half * 2);
  let count = 0;

  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count += 1;

  return count;
};

const shapes = [
  makeMove({
    id: 'line',
    seq: 1,
    path: [
      [100, 100],
      [300, 100],
    ],
    options: { ...makeMove().options, lineWidth: 6, lineColor: black },
  }),
  makeMove({
    id: 'rect',
    seq: 2,
    path: [[400, 100]],
    rect: { width: 200, height: 100 },
    options: { ...makeMove().options, shape: 'rect', lineWidth: 4, lineColor: black },
  }),
  makeMove({
    id: 'circle',
    seq: 3,
    path: [[800, 200]],
    circle: { cX: 800, cY: 200, radiusX: 80, radiusY: 60 },
    options: {
      ...makeMove().options,
      shape: 'circle',
      lineWidth: 4,
      lineColor: black,
      fillColor: { r: 255, g: 0, b: 0, a: 1 },
    },
  }),
];

describe('renderBoard', () => {
  let dir: string;
  let storage: LocalStorage;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'collab-render-'));
    storage = new LocalStorage({ dir, secret: 's' });
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('renders shapes at board size, transparent where nothing was drawn', async () => {
    const canvas = await renderBoard(shapes, { loader: createNodeImageLoader(storage) });

    expect(canvas.width).toBe(CANVAS_SIZE.width);
    expect(canvas.height).toBe(CANVAS_SIZE.height);
    expect(opaqueAt(canvas, 200, 100)).toBeGreaterThan(0); // on the line
    expect(opaqueAt(canvas, 400, 150)).toBeGreaterThan(0); // rect's left edge
    expect(opaqueAt(canvas, 800, 200)).toBeGreaterThan(0); // filled ellipse
    expect(opaqueAt(canvas, 2000, 1500)).toBe(0);

    const png = await encodePng(canvas);
    expect(png.length).toBeGreaterThan(100);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
  });

  it('is deterministic: the same moves give identical pixels twice', async () => {
    const loader = createNodeImageLoader(storage);
    const a = await renderBoard(shapes, { loader });
    const b = await renderBoard([...shapes].reverse(), { loader });

    expect(Buffer.compare(a.toBuffer('image/png'), b.toBuffer('image/png'))).toBe(0);
  });

  it('composites a stored snapshot image underneath later moves', async () => {
    const loader = createNodeImageLoader(storage);

    // Render the first two shapes, store them as a snapshot image...
    const base = await renderBoard(shapes.slice(0, 2), { loader });
    await storage.put('boards/x/snapshots/2.png', await encodePng(base), 'image/png');

    const snapshotMove = makeMove({
      id: 'snapshot:2',
      seq: 2,
      path: [[0, 0]],
      img: { url: storage.publicUrl('boards/x/snapshots/2.png') },
      options: { ...makeMove().options, shape: 'image' },
    });

    // ...then render the snapshot plus the third shape.
    const canvas = await renderBoard([snapshotMove, shapes[2]], { loader });

    expect(opaqueAt(canvas, 200, 100)).toBeGreaterThan(0); // from the snapshot
    expect(opaqueAt(canvas, 800, 200)).toBeGreaterThan(0); // drawn after it
  });

  it('decodes inline data URLs and scales down for thumbnails with a background', async () => {
    const loader = createNodeImageLoader(storage);
    const tiny = await renderBoard(shapes.slice(0, 1), { loader });
    const dataUrl = `data:image/png;base64,${(await encodePng(tiny)).toString('base64')}`;

    const imageMove = makeMove({
      id: 'inline',
      seq: 1,
      path: [[0, 0]],
      img: { base64: dataUrl },
      options: { ...makeMove().options, shape: 'image' },
    });

    const thumb = await renderBoard([imageMove], {
      loader,
      scale: 0.12,
      background: { mode: 'light', lines: true },
    });

    expect(thumb.width).toBe(480);
    expect(thumb.height).toBe(240);
    // Background makes every pixel opaque; the webp encodes.
    expect(opaqueAt(thumb, 400, 200, 4)).toBe(64);
    expect((await encodeWebp(thumb)).length).toBeGreaterThan(100);
  });

  it('skips an image that cannot be loaded and still draws the rest', async () => {
    const loader = createNodeImageLoader(storage);
    const broken = makeMove({
      id: 'broken',
      seq: 1,
      path: [[0, 0]],
      img: { url: '/uploads/does/not/exist.png' },
      options: { ...makeMove().options, shape: 'image' },
    });

    const canvas = await renderBoard([broken, shapes[0]], { loader });

    expect(opaqueAt(canvas, 200, 100)).toBeGreaterThan(0);
  });
});
