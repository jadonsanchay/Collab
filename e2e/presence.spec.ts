import { expect, test } from '@playwright/test';

/**
 * Presence: remote cursors render with the sender's name, and a dropped
 * socket marks the user offline immediately (not just after the grace
 * window expires into `user_disconnected` — that part is RoomStore's job
 * and is covered by the server unit tests instead).
 */

test('a remote cursor renders with the sender name, and a dropped socket marks them offline', async ({
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

    const aliceTile = bob.getByTitle('Alice');
    await expect(aliceTile).toBeVisible();

    await alice.mouse.move(400, 300);
    await alice.mouse.move(450, 340, { steps: 5 });

    await expect(bob.locator('p.ml-2', { hasText: 'Alice' })).toBeVisible();

    await aliceContext.close();

    await expect(aliceTile).toHaveAttribute(
      'title',
      'Alice (reconnecting)',
    );
  } finally {
    // aliceContext is already closed above; closing it again is a no-op.
    await aliceContext.close();
    await bobContext.close();
  }
});
