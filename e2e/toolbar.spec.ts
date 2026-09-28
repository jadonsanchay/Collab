import { expect, test } from '@playwright/test';

/**
 * Toolbar redesign (Step 8): hotkeys switch tools, the command palette opens
 * and lists commands, and the shortcuts sheet opens on `?`. All exercised on
 * a single page — none of this depends on a second client.
 */

const createRoom = async (page: import('@playwright/test').Page) => {
  await page.goto('/');
  await page.getByLabel('Enter your name').fill('Alice');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('canvas.z-10')).toHaveCount(1);
};

test('hotkeys switch the active tool and shape', async ({ page }) => {
  await createRoom(page);

  // Clear of the canvas and any control, so the key lands on `document`.
  await page.mouse.move(50, 50);

  await page.keyboard.press('v');
  await expect(page.getByRole('radio', { name: 'Select' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  await page.keyboard.press('p');
  await expect(page.getByRole('radio', { name: 'Pen' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  await page.keyboard.press('r');
  await expect(
    page.getByRole('radio', { name: 'Rectangle' }),
  ).toHaveAttribute('aria-checked', 'true');

  await page.keyboard.press('o');
  await expect(page.getByRole('radio', { name: 'Circle' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('does not fire tool hotkeys while typing in chat', async ({ page }) => {
  await createRoom(page);

  await page.getByRole('button', { name: 'Chat' }).click();
  await page.getByLabel('Message').fill('r is just a letter here');

  await expect(
    page.getByRole('radio', { name: 'Rectangle' }),
  ).not.toHaveAttribute('aria-checked', 'true');
});

test('command palette opens on cmd+k and runs a command', async ({
  page,
}) => {
  await createRoom(page);
  await page.mouse.move(50, 50);

  await page.keyboard.press('Meta+k');
  await expect(page.getByPlaceholder('Type a command...')).toBeVisible();
  await expect(page.getByText('Tools')).toBeVisible();

  await page.getByText('Rectangle', { exact: true }).click();
  await expect(page.getByPlaceholder('Type a command...')).toBeHidden();
  await expect(
    page.getByRole('radio', { name: 'Rectangle' }),
  ).toHaveAttribute('aria-checked', 'true');
});

test('shortcuts sheet opens on "?"', async ({ page }) => {
  await createRoom(page);
  await page.mouse.move(50, 50);

  await page.keyboard.press('Shift+?');
  await expect(
    page.getByRole('heading', { name: 'Keyboard shortcuts' }),
  ).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('heading', { name: 'Keyboard shortcuts' }),
  ).toBeHidden();
});
