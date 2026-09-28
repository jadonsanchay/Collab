import { expect, test, type Page } from '@playwright/test';

/**
 * The two-window smoke test.
 *
 * Each window gets its own browser context, which matters more than it looks:
 * identity lives in `localStorage`, so two pages in one context would be the
 * same user and none of this would prove anything.
 */

/** Ink inside a small box around a viewport point, on the drawing canvas. */
const inkAround = (page: Page, vx: number, vy: number) =>
  page.locator('canvas.z-10').evaluate(
    (element, { x, y }) => {
      const canvas = element as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');

      if (!ctx) return 0;

      const rect = canvas.getBoundingClientRect();
      const half = 40;
      const left = Math.max(0, Math.round(x - rect.left) - half);
      const top = Math.max(0, Math.round(y - rect.top) - half);

      const { data } = ctx.getImageData(left, top, half * 2, half * 2);

      let opaque = 0;
      // Every fourth byte is alpha; anything above zero is a drawn pixel.
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) opaque += 1;
      }

      return opaque;
    },
    { x: vx, y: vy },
  );

const drawStroke = async (page: Page) => {
  // Mid-canvas, clear of the toolbar on the left and the chat tab at the
  // bottom, so the events land on the canvas and not on a control.
  await page.mouse.move(500, 380);
  await page.mouse.down();
  await page.mouse.move(560, 440, { steps: 10 });
  await page.mouse.move(620, 480, { steps: 10 });
  await page.mouse.up();
};

test('two windows share a board, a stroke, and a message', async ({
  browser,
}) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  try {
    // --- Alice creates a room (A1) ---
    await alice.goto('/');
    await alice.getByLabel('Enter your name').fill('Alice');
    await alice.getByRole('button', { name: 'Create' }).click();

    await expect(alice).toHaveURL(/\/[A-Za-z0-9_-]{8}$/);
    const roomId = new URL(alice.url()).pathname.slice(1);

    // The board, not the name gate.
    await expect(alice.locator('canvas.z-10')).toHaveCount(1);

    // --- Bob joins by URL (A2) ---
    await bob.goto(`/${roomId}`);
    await bob.getByLabel('Enter your name').fill('Bob');
    await bob.getByRole('button', { name: 'Enter room' }).click();

    await expect(bob.locator('canvas.z-10')).toHaveCount(1);

    // Each sees exactly one other person: the avatar stack excludes yourself.
    await expect(alice.getByTitle('Bob')).toBeVisible();
    await expect(bob.getByTitle('Alice')).toBeVisible();

    // --- Alice draws, Bob sees it (A3) ---
    expect(await inkAround(bob, 560, 440)).toBe(0);

    await drawStroke(alice);

    await expect
      .poll(() => inkAround(alice, 560, 440), {
        message: 'the stroke should appear on the canvas that drew it',
      })
      .toBeGreaterThan(0);

    await expect
      .poll(() => inkAround(bob, 560, 440), {
        message: "the stroke should arrive in the other window's canvas",
      })
      .toBeGreaterThan(0);

    // --- Bob sends a message, Alice reads it (A10) ---
    await alice.getByRole('button', { name: 'Chat' }).click();
    await bob.getByRole('button', { name: 'Chat' }).click();

    await bob.getByLabel('Message').fill('hello from the other window');
    await bob.getByLabel('Message').press('Enter');

    /**
     * Twice, by design: once in the chat panel and once as a bubble beside the
     * sender's cursor. Asserting the count pins that behaviour rather than
     * quietly matching whichever copy came first.
     */
    await expect(
      alice.getByText('hello from the other window'),
    ).toHaveCount(2);

    // Attributed to its sender, which is what the stable user id is for. The
    // heading is the chat panel's copy specifically.
    await expect(
      alice.getByRole('heading', { name: 'Bob', level: 5 }),
    ).toBeVisible();
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});

test('a room id that does not exist sends you home', async ({ page }) => {
  // `commit` rather than the default `load`: the page redirects itself as soon
  // as the socket answers, which can race the load event and hang the wait.
  await page.goto('/aaaaaaaa', { waitUntil: 'commit' });

  // A16: the check happens over the socket, so the redirect is not instant.
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('button', { name: 'Create' })).toBeVisible();
});
