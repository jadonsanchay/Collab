import { expect, test } from '@playwright/test';

/**
 * Features the server has not switched on leave no trace in the UI. The
 * e2e server runs without LiveKit, so the call entry must be absent; the
 * fake AI is on, so its entry must be present. Both come from the same
 * `features` payload.
 */
test('flags from the server decide which entry points render', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Enter your name').fill('Alice');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('canvas.z-10')).toHaveCount(1);

  await expect(page.getByRole('button', { name: 'Ask Sketch' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rewind' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Join call' })).toHaveCount(0);

  // No media SDK in the page without the flag.
  const hasLiveKit = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .some((entry) => /livekit/i.test(entry.name)),
  );
  expect(hasLiveKit).toBe(false);
});
