import { expect, test } from '@playwright/test';

/**
 * A compact button with no icon keeps its width, and its neighbour keeps its
 * place, when it turns busy (SUS-157). jsdom lays nothing out, so this is the
 * check that measures: the gallery's "Done" / "Undo" pair, before and after.
 */
test.describe('a busy compact button', () => {
  test('keeps its width and does not move its neighbour', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/components');

    const done = page.getByRole('button', { name: 'Done', exact: true });
    const undo = page.getByRole('button', { name: 'Undo', exact: true });
    await done.scrollIntoViewIfNeeded();
    const before = { done: await done.boundingBox(), undo: await undo.boundingBox() };
    expect(before.done).not.toBeNull();

    await page.getByRole('button', { name: 'Turn busy on' }).click();
    const busy = page.getByRole('button', { name: 'Finishing', exact: true });
    await expect(busy).toHaveAttribute('aria-busy', 'true');
    // The spinner arrives about 150 ms after the button turns busy.
    await expect(busy.getByTestId('spinner')).toBeVisible();

    const after = { done: await busy.boundingBox(), undo: await undo.boundingBox() };
    expect(after.done?.width).toBe(before.done?.width);
    expect(after.done?.height).toBe(before.done?.height);
    expect(after.undo?.x).toBe(before.undo?.x);
  });
});
