import { expect, test, type Page } from '@playwright/test';

/**
 * Sketch, the AI teammate, with the fake agent (`AI_ENABLED=1 AI_FAKE=1`
 * from playwright.config.ts). No network, no key: what is under test is the
 * room-level behaviour — Sketch joins as a member, its moves reach every
 * window, and "Undo Sketch" removes them everywhere.
 */

const inkAround = (page: Page, vx: number, vy: number, half = 30) =>
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

const openTwoWindows = async (browser: import('@playwright/test').Browser) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  await alice.goto('/');
  await alice.getByLabel('Enter your name').fill('Alice');
  await alice.getByRole('button', { name: 'Create' }).click();
  await expect(alice.locator('canvas.z-10')).toHaveCount(1);
  const roomId = new URL(alice.url()).pathname.slice(1);

  await bob.goto(`/${roomId}`);
  await bob.getByLabel('Enter your name').fill('Bob');
  await bob.getByRole('button', { name: 'Enter room' }).click();
  await expect(bob.locator('canvas.z-10')).toHaveCount(1);

  return { alice, bob, close: () => Promise.all([aliceContext.close(), bobContext.close()]) };
};

test('clean up with Sketch draws in both windows and Undo Sketch removes it everywhere', async ({
  browser,
}) => {
  const { alice, bob, close } = await openTwoWindows(browser);

  try {
    // The AI entry points exist because the server said the feature is on.
    await expect(alice.getByRole('button', { name: 'Ask Sketch' })).toBeVisible();

    // A rough stroke to clean up.
    await alice.mouse.move(500, 380);
    await alice.mouse.down();
    await alice.mouse.move(560, 440, { steps: 10 });
    await alice.mouse.move(620, 480, { steps: 10 });
    await alice.mouse.up();

    await expect.poll(() => inkAround(bob, 560, 440)).toBeGreaterThan(0);

    // Select the region around it.
    await alice.mouse.move(50, 50);
    await alice.keyboard.press('v');
    await alice.mouse.move(480, 360);
    await alice.mouse.down();
    await alice.mouse.move(640, 500, { steps: 8 });
    await alice.mouse.up();

    const cleanup = alice.getByRole('button', { name: 'Clean up with Sketch' });
    await expect(cleanup).toBeVisible();

    // The redrawn copy lands to the right of the selection (40 px gap); the
    // fake program's outer rectangle covers this spot and the original does not.
    const target = { x: 760, y: 415 };
    expect(await inkAround(bob, target.x, target.y)).toBe(0);

    await cleanup.click();

    // Sketch joins the room as a member in both windows.
    await expect(alice.getByTitle(/^Sketch/)).toBeVisible();
    await expect(bob.getByTitle(/^Sketch/)).toBeVisible();

    await expect
      .poll(() => inkAround(alice, target.x, target.y), {
        message: "Sketch's drawing should appear for the requester",
      })
      .toBeGreaterThan(0);
    await expect
      .poll(() => inkAround(bob, target.x, target.y), {
        message: "Sketch's drawing should appear in the other window",
      })
      .toBeGreaterThan(0);

    // Sketch reports in chat when it is done.
    await bob.getByRole('button', { name: 'Chat' }).click();
    await expect(bob.getByText('Cleaned up your sketch.')).toHaveCount(2);

    // Only the requester gets the undo action.
    const undo = alice.getByRole('button', { name: 'Undo Sketch' });
    await expect(undo).toBeVisible();
    await expect(bob.getByRole('button', { name: 'Undo Sketch' })).toHaveCount(0);

    await undo.click();

    await expect
      .poll(() => inkAround(alice, target.x, target.y), {
        message: 'undo should remove the drawing for the requester',
      })
      .toBe(0);
    await expect
      .poll(() => inkAround(bob, target.x, target.y), {
        message: 'undo should remove the drawing in the other window',
      })
      .toBe(0);

    // The original stroke is untouched.
    expect(await inkAround(bob, 560, 440)).toBeGreaterThan(0);
  } finally {
    await close();
  }
});

test('"@sketch" in chat asks Sketch to draw and the palette offers Sketch commands', async ({
  browser,
}) => {
  const { alice, bob, close } = await openTwoWindows(browser);

  try {
    await alice.mouse.move(50, 50);
    await alice.keyboard.press('Meta+k');
    await expect(alice.getByText('Ask Sketch to draw…')).toBeVisible();
    await alice.keyboard.press('Escape');

    await alice.getByRole('button', { name: 'Chat' }).click();
    await alice.getByLabel('Message').fill('@sketch draw a lighthouse');
    await alice.getByLabel('Message').press('Enter');

    // The mention is an ordinary message too.
    await bob.getByRole('button', { name: 'Chat' }).click();
    await expect(bob.getByText('@sketch draw a lighthouse')).toHaveCount(2);

    await expect(bob.getByTitle(/^Sketch/)).toBeVisible();
    // Twice, like any chat message: the panel and the bubble by Sketch's cursor.
    await expect(bob.getByText('Here is draw a lighthouse.')).toHaveCount(2);
  } finally {
    await close();
  }
});
