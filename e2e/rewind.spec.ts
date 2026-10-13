import { statSync } from 'fs';

import { expect, test, type Page } from '@playwright/test';

/**
 * Rewind: scrubbing shows exactly the moves up to the cursor, the board is
 * read-only while in the past, "Live" restores everything, author chips
 * filter, and the timelapse export produces a WebM file.
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

const drawStroke = async (page: Page, x: number, y: number) => {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 60, { steps: 8 });
  await page.mouse.up();
};

test('scrub back, read-only while in the past, back to live, filter, export', async ({
  page,
}) => {
  await page.goto('/?engine=raster');
  await page.getByLabel('Enter your name').fill('Alice');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('canvas.z-10')).toHaveCount(1);

  const first = { x: 300, y: 300 };
  const second = { x: 700, y: 300 };

  await drawStroke(page, first.x, first.y);
  await expect.poll(() => inkAround(page, first.x + 30, first.y + 30)).toBeGreaterThan(0);

  await drawStroke(page, second.x, second.y);
  await expect.poll(() => inkAround(page, second.x + 30, second.y + 30)).toBeGreaterThan(0);

  // Open the panel with the hotkey.
  await page.mouse.move(50, 50);
  await page.keyboard.press('Meta+Shift+h');
  const panel = page.getByRole('region', { name: 'Rewind' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('2 / 2')).toBeVisible();

  // One step back: the second stroke is gone, the first stays.
  const slider = panel.getByRole('slider');
  await slider.focus();
  await page.keyboard.press('ArrowLeft');

  await expect(page.getByRole('status')).toContainText('Viewing history');
  await expect(panel.getByText('1 / 2')).toBeVisible();
  await expect.poll(() => inkAround(page, second.x + 30, second.y + 30)).toBe(0);
  expect(await inkAround(page, first.x + 30, first.y + 30)).toBeGreaterThan(0);

  // Drawing is refused while viewing history.
  await drawStroke(page, 500, 500);
  await page.waitForTimeout(300);
  expect(await inkAround(page, 530, 530)).toBe(0);

  // Back to live restores everything.
  await page.getByRole('button', { name: 'Back to live' }).click();
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect.poll(() => inkAround(page, second.x + 30, second.y + 30)).toBeGreaterThan(0);

  // Deselecting the only author hides every move; selecting again shows them.
  const me = panel.getByRole('button', { name: 'You' });
  await me.click();
  await expect.poll(() => inkAround(page, first.x + 30, first.y + 30)).toBe(0);
  await me.click();
  await expect.poll(() => inkAround(page, first.x + 30, first.y + 30)).toBeGreaterThan(0);

  // The timelapse downloads as a non-empty WebM.
  const downloadPromise = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Export timelapse' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^collab-[A-Za-z0-9_-]{8}\.webm$/);

  const path = await download.path();
  expect(path).not.toBeNull();
  expect(statSync(path as string).size).toBeGreaterThan(0);
});
