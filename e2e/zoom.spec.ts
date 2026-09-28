import { expect, test } from '@playwright/test';

/** Zoom controls: zoom in/out, reset to 100%, and fit-to-board. */

test('zoom in, zoom out, and reset all update the displayed percentage', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Enter your name').fill('Alice');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('canvas.z-10')).toHaveCount(1);

  const readout = page.getByRole('button', { name: 'Reset zoom to 100%' });
  await expect(readout).toHaveText('100%');

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(readout).not.toHaveText('100%');

  await readout.click();
  await expect(readout).toHaveText('100%');

  await page.getByRole('button', { name: 'Zoom out' }).click();
  await expect(readout).not.toHaveText('100%');

  await page.getByRole('button', { name: 'Fit board to screen' }).click();
  await expect(readout).toBeVisible();
});
