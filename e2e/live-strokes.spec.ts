import { expect, test, type Page } from '@playwright/test';

/**
 * Live strokes stream to other clients before pointer-up (the remote-live
 * canvas, z-15) — not just once the move is committed (z-10). Two contexts,
 * for the same reason as sync.spec.ts: identity lives in localStorage.
 */

const inkCount = (page: Page, selector: string, vx: number, vy: number) =>
  page.locator(selector).evaluate(
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
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) opaque += 1;
      }
      return opaque;
    },
    { x: vx, y: vy },
  );

test('a stroke appears on the remote-live layer before pointer-up', async ({
  browser,
}) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  try {
    await alice.goto('/');
    await alice.getByLabel('Enter your name').fill('Alice');
    await alice.getByRole('button', { name: 'Create' }).click();
    await expect(alice.locator('canvas.z-10')).toHaveCount(1);
    const roomId = new URL(alice.url()).pathname.slice(1);

    await bob.goto(`/${roomId}`);
    await bob.getByLabel('Enter your name').fill('Bob');
    await bob.getByRole('button', { name: 'Enter room' }).click();
    await expect(bob.locator('canvas.z-10')).toHaveCount(1);
    await expect(alice.getByTitle('Bob')).toBeVisible();

    // Mid-stroke: pointer down and moved, but not yet up.
    await alice.mouse.move(500, 380);
    await alice.mouse.down();
    await alice.mouse.move(560, 440, { steps: 10 });

    await expect
      .poll(() => inkCount(bob, 'canvas.z-\\[15\\]', 560, 440), {
        message: 'the in-progress stroke should render on the remote-live layer',
      })
      .toBeGreaterThan(0);

    // Still not committed on Bob's side.
    expect(await inkCount(bob, 'canvas.z-10', 560, 440)).toBe(0);

    await alice.mouse.move(620, 480, { steps: 10 });
    await alice.mouse.up();

    await expect
      .poll(() => inkCount(bob, 'canvas.z-10', 560, 440), {
        message: 'the finished stroke should land on the committed layer',
      })
      .toBeGreaterThan(0);
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});
