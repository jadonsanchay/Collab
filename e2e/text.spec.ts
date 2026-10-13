import { expect, test, type Page } from '@playwright/test';

/**
 * The text tool (Phase 2, Step 1): `T` selects it, a click places a text box,
 * Enter commits a `text` move, and the rendered text reaches the other window.
 */

const inkAround = (page: Page, vx: number, vy: number, half = 40) =>
  page.locator('canvas.z-10').evaluate(
    (element, { x, y, h }) => {
      const canvas = element as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');

      if (!ctx) return 0;

      const rect = canvas.getBoundingClientRect();
      const left = Math.max(0, Math.round(x - rect.left) - h);
      const top = Math.max(0, Math.round(y - rect.top) - h);
      const { data } = ctx.getImageData(left, top, h * 2, h * 2);

      let opaque = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) opaque += 1;
      }

      return opaque;
    },
    { x: vx, y: vy, h: half },
  );

test('text typed in one window renders in both', async ({ browser }) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  try {
    await alice.goto('/?engine=raster');
    await alice.getByLabel('Enter your name').fill('Alice');
    await alice.getByRole('button', { name: 'Create' }).click();
    await expect(alice.locator('canvas.z-10')).toHaveCount(1);
    const roomId = new URL(alice.url()).pathname.slice(1);

    await bob.goto(`/${roomId}`);
    await bob.getByLabel('Enter your name').fill('Bob');
    await bob.getByRole('button', { name: 'Enter room' }).click();
    await expect(bob.locator('canvas.z-10')).toHaveCount(1);

    expect(await inkAround(bob, 540, 400)).toBe(0);

    // Off the canvas so the hotkey reaches `document`, then select the tool.
    await alice.mouse.move(50, 50);
    await alice.keyboard.press('t');
    await expect(alice.getByRole('radio', { name: 'Text' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await alice.mouse.click(500, 380);

    const box = alice.getByRole('textbox', { name: 'Text' });
    await expect(box).toBeVisible();
    await expect(box).toBeFocused();

    await box.fill('Hello board');
    await box.press('Enter');

    await expect(box).toBeHidden();

    await expect
      .poll(() => inkAround(alice, 540, 400), {
        message: 'the text should render on the canvas that placed it',
      })
      .toBeGreaterThan(0);

    await expect
      .poll(() => inkAround(bob, 540, 400), {
        message: 'the text should render in the other window',
      })
      .toBeGreaterThan(0);
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});

test('escape cancels a text box without drawing anything', async ({
  page,
}) => {
  await page.goto('/?engine=raster');
  await page.getByLabel('Enter your name').fill('Alice');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('canvas.z-10')).toHaveCount(1);

  await page.mouse.move(50, 50);
  await page.keyboard.press('t');
  await page.mouse.click(500, 380);

  const box = page.getByRole('textbox', { name: 'Text' });
  await expect(box).toBeVisible();
  await box.fill('never committed');
  await box.press('Escape');

  await expect(box).toBeHidden();
  // Give a stray move time to arrive if one were sent.
  await page.waitForTimeout(300);
  expect(await inkAround(page, 540, 400)).toBe(0);
});
