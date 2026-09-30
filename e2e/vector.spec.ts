import { expect, test, type Page } from '@playwright/test';

/**
 * The objects (vector) engine, end to end: two browsers, one Yjs document
 * through the sync server, plus the Socket.IO room around it. Covers what
 * only a real pair of windows can: a stroke arriving, a sticky note's text
 * following keystrokes, and a delete undone from the window that did it.
 */

const VECTOR_CANVAS = 'canvas[data-engine="vector"]';

/** Drawn pixels inside a small box around a viewport point. */
const inkAround = (page: Page, vx: number, vy: number) =>
  page.locator(VECTOR_CANVAS).evaluate(
    (element, { x, y }) => {
      const canvas = element as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');

      if (!ctx) return 0;

      const dpr = canvas.width / canvas.getBoundingClientRect().width;
      const half = 30;
      const left = Math.max(0, Math.round((x - half) * dpr));
      const top = Math.max(0, Math.round((y - half) * dpr));
      const size = Math.round(half * 2 * dpr);

      const { data } = ctx.getImageData(left, top, size, size);

      let opaque = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) opaque += 1;
      }

      return opaque;
    },
    { x: vx, y: vy },
  );

const createVectorRoom = async (page: Page, name: string) => {
  await page.goto('/');
  await page.getByLabel('Enter your name').fill(name);
  await page.getByLabel(/Objects board/).check();
  await page.getByRole('button', { name: 'Create' }).click();

  await expect(page).toHaveURL(/\/[A-Za-z0-9_-]{8}$/);
  // The vector engine is a separate chunk that dev-mode Next builds on its
  // first request, so the first board of a run can take a while to appear.
  await expect(page.locator(VECTOR_CANVAS)).toHaveCount(1, { timeout: 30_000 });

  return new URL(page.url()).pathname.slice(1);
};

const joinRoom = async (page: Page, roomId: string, name: string) => {
  await page.goto(`/${roomId}`);
  await page.getByLabel('Enter your name').fill(name);
  await page.getByRole('button', { name: 'Enter room' }).click();
  await expect(page.locator(VECTOR_CANVAS)).toHaveCount(1);
};

test('an objects board syncs strokes, sticky text and undo between two windows', async ({
  browser,
}) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  try {
    const roomId = await createVectorRoom(alice, 'Alice');
    await joinRoom(bob, roomId, 'Bob');

    // Both documents are live before anything is drawn.
    await expect(alice.getByText('Connecting to the document')).toHaveCount(0);
    await expect(bob.getByText('Connecting to the document')).toHaveCount(0);

    // --- A stroke drawn in one window lands in the other ---
    expect(await inkAround(bob, 560, 440)).toBe(0);

    await alice.getByRole('radio', { name: 'Pen' }).click();
    await alice.mouse.move(500, 380);
    await alice.mouse.down();
    await alice.mouse.move(560, 440, { steps: 10 });
    await alice.mouse.move(620, 480, { steps: 10 });
    await alice.mouse.up();

    await expect
      .poll(() => inkAround(alice, 560, 440), { message: 'the stroke should render locally' })
      .toBeGreaterThan(0);
    await expect
      .poll(() => inkAround(bob, 560, 440), { message: 'the stroke should reach the other window' })
      .toBeGreaterThan(0);

    // --- A sticky note, typed into live ---
    await alice.getByRole('radio', { name: 'Sticky note' }).click();
    await alice.mouse.click(800, 250);

    // Placing a sticky opens its editor straight away.
    const aliceEditor = alice.getByRole('textbox', { name: 'Edit text' });
    await expect(aliceEditor).toBeFocused();
    await aliceEditor.pressSequentially('Ship it');
    await alice.keyboard.press('Escape');

    // Bob opens the same note (double-click on it; notes centre on the click
    // that placed them) and finds the text there.
    await bob.mouse.dblclick(800, 250);
    const bobEditor = bob.getByRole('textbox', { name: 'Edit text' });
    await expect(bobEditor).toHaveValue('Ship it');
    await bob.keyboard.press('Escape');

    // --- Delete in one window, undo it in the same window; both follow ---
    await alice.getByRole('radio', { name: 'Select' }).click();
    await alice.mouse.click(560, 440);
    await alice.keyboard.press('Delete');

    await expect
      .poll(() => inkAround(bob, 560, 440), { message: 'the deleted stroke should vanish remotely' })
      .toBe(0);

    await alice.keyboard.press('ControlOrMeta+z');

    await expect
      .poll(() => inkAround(alice, 560, 440), { message: 'undo should bring the stroke back' })
      .toBeGreaterThan(0);
    await expect
      .poll(() => inkAround(bob, 560, 440), { message: 'the undone delete should reach the other window' })
      .toBeGreaterThan(0);

    // The room chrome around the document is the same as on a drawing board.
    await expect(alice.getByTitle('Bob')).toBeVisible();
    await expect(bob.getByTitle('Alice')).toBeVisible();
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});

test('an objects board survives a reload with its objects intact', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await createVectorRoom(page, 'Alice');
    await expect(page.getByText('Connecting to the document')).toHaveCount(0);

    await page.getByRole('radio', { name: 'Rectangle' }).click();
    await page.mouse.move(400, 300);
    await page.mouse.down();
    await page.mouse.move(600, 450, { steps: 5 });
    await page.mouse.up();

    await expect.poll(() => inkAround(page, 400, 300)).toBeGreaterThan(0);

    // Names are not remembered, so a reload goes through the name gate again.
    await page.reload();
    await page.getByLabel('Enter your name').fill('Alice');
    await page.getByRole('button', { name: 'Enter room' }).click();
    await expect(page.locator(VECTOR_CANVAS)).toHaveCount(1);

    // The document comes back from the server, not from this tab.
    await expect.poll(() => inkAround(page, 400, 300)).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});
