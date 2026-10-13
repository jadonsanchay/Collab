import { expect, test } from '@playwright/test';

/**
 * The boards dashboard on a persistent server: create from a template, the
 * board renders the template's moves, the card appears with its title, it
 * can be renamed and deleted. Playwright starts the server with
 * `STORAGE=pglite`, so this runs without any infrastructure.
 */

const inkAnywhere = (page: import('@playwright/test').Page) =>
  page.locator('canvas.z-10').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');

    if (!ctx) return 0;

    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4 * 97) {
      if (data[i] > 0) opaque += 1;
    }

    return opaque;
  });

test('create a board from a template, rename it, delete it', async ({ page }) => {
  // Visiting the app once gives this browser its guest identity. The corner
  // shows Sign in or My boards depending on whether sign-in is configured,
  // so the dashboard is reached by URL here.
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Create' })).toBeVisible();

  await page.goto('/boards');
  await expect(page.getByRole('heading', { name: 'My boards' })).toBeVisible();
  await expect(page.getByText('No boards yet. Create one above.')).toBeVisible();

  await page.getByRole('button', { name: /Kanban/ }).click();

  await expect(page).toHaveURL(/\/[A-Za-z0-9_-]{8}$/);
  await page.getByLabel('Enter your name').fill('Alice');
  await page.getByRole('button', { name: 'Enter room' }).click();
  await expect(page.locator('canvas.z-10')).toHaveCount(1);

  // The template's columns are on the board.
  await expect.poll(() => inkAnywhere(page)).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Rename board' })).toHaveText('Kanban');

  // Rename from the top bar (the creator owns it).
  await page.getByRole('button', { name: 'Rename board' }).click();
  await page.getByLabel('Board title').fill('Release plan');
  await page.getByLabel('Board title').press('Enter');
  await expect(page.getByRole('button', { name: 'Rename board' })).toHaveText('Release plan');

  // Back on the dashboard: the card, with its new title, then delete it.
  await page.getByRole('link', { name: 'My boards' }).click();
  await expect(page.getByRole('heading', { name: 'My boards' })).toBeVisible();

  const card = page.locator('li').filter({ hasText: 'Release plan' }).first();
  await expect(card).toBeVisible();
  await expect(card.getByText(/owner ·/)).toBeVisible();

  await card.getByRole('button', { name: 'Star' }).click();
  await expect(page.getByRole('heading', { name: 'Starred' })).toBeVisible();

  await card.getByRole('button', { name: 'Delete' }).click();
  await card.getByRole('button', { name: 'Confirm delete' }).click();

  await expect(page.getByText('Release plan')).toHaveCount(0);
  await expect(page.getByText('No boards yet. Create one above.')).toBeVisible();
});
