import { expect, test } from '@playwright/test';

/**
 * Email/username + password accounts: sign up lands on the dashboard signed
 * in, the landing page corner then offers the dashboard instead of Sign in,
 * and a wrong password comes back to the login page with a message.
 */
test('sign up, land on the dashboard signed in, sign out, sign back in', async ({ page }) => {
  const stamp = Date.now().toString(36);
  const email = `e2e-${stamp}@example.com`;

  await page.goto('/');
  await page.getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page).toHaveURL(/\/signup$/);

  await page.locator('#signup-name').fill('E2E Person');

  // The handle is dealt by the server; rolling gives a different one.
  const generated = page.getByTestId('generated-username');
  await expect(generated).toHaveText(/^[a-z]+_[a-z]+_[a-z]+$/);
  const first = await generated.textContent();
  await page.getByRole('button', { name: 'Generate another username' }).click();
  await expect(generated).not.toHaveText(first ?? '');
  const username = (await generated.textContent()) ?? '';
  await page.locator('#signup-email').fill(email);
  await page.locator('#signup-password').fill('a-long-enough-password');
  await page.getByRole('button', { name: 'Create account' }).click();

  // Signed in and on the dashboard, shown by name.
  await expect(page).toHaveURL(/\/boards$/);
  await expect(page.getByRole('heading', { name: 'My boards' })).toBeVisible();
  await expect(page.getByText('E2E Person')).toBeVisible();
  await expect(page.getByText(`@${username}`)).toBeVisible();

  // The landing page corner now points at the dashboard, and the name field is gone.
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'My boards' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
  await expect(page.getByText('Signed in as')).toBeVisible();
  await expect(page.getByLabel('Enter your name')).toHaveCount(0);

  // Creating and entering a board needs no name: the account name is used.
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/[A-Za-z0-9_-]{8}$/);
  await expect(page.locator('canvas[data-engine="vector"]')).toHaveCount(1, { timeout: 30_000 });
  await page.reload();
  await expect(page.getByLabel('Enter your name')).toHaveCount(0);
  await expect(page.locator('canvas[data-engine="vector"]')).toHaveCount(1);

  // Sign out through Auth.js's confirmation, then a wrong password is refused.
  await page.goto('/boards');
  await page.getByRole('link', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: /sign out/i }).click();
  await page.goto('/login');
  await page.locator('#identifier').fill(username);
  await page.locator('#password').fill('wrong-password-here');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Wrong email, username or password.')).toBeVisible();

  // The right one; the username survived the redirect.
  await expect(page.locator('#identifier')).toHaveValue(username);
  await page.locator('#password').fill('a-long-enough-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/boards$/);
  await expect(page.getByText('E2E Person')).toBeVisible();
});
