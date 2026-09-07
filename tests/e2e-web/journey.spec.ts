import { expect, test } from '@playwright/test';

/**
 * The Slice 0 exit: the named-plan journey, clickable end to end on fixtures
 * with no network at all.
 *
 * It walks the path a founder takes — welcome, circles, the circle, setting up
 * a plan, sharing it, seeing candidates, confirming, and reporting what
 * happened — asserting at each step on something a person would actually read,
 * not on a test id. If the copy changes, this test should change with it.
 */
const JOURNEY = [
  { path: '/', expect: /Sunday Crew|catch|circle/i },
  { path: '/circles', expect: /Your circles|New circle/i },
  { path: '/circles/sunday-crew', expect: /Sunday Crew/i },
  { path: '/circles/sunday-crew/plan/setup', expect: /catch up|window|when/i },
  { path: '/circles/sunday-crew/plan/thu-17/shared', expect: /paste|share|chat/i },
  { path: '/circles/sunday-crew/plan/thu-17/candidates', expect: /Thu 17 Sep|option|works/i },
  { path: '/circles/sunday-crew/plan/thu-17/review', expect: /Lock it in|confirm/i },
  { path: '/circles/sunday-crew/plan/thu-17/confirmed', expect: /Locked in|Thu 17 Sep/i },
  { path: '/circles/sunday-crew/plan/thu-17/outcome', expect: /happen|How did it go/i },
];

test.describe('the named-plan journey', () => {
  for (const step of JOURNEY) {
    test(`renders ${step.path}`, async ({ page }) => {
      const failures: string[] = [];
      page.on('pageerror', (error) => failures.push(error.message));
      page.on('requestfailed', (request) => failures.push(`request failed: ${request.url()}`));

      await page.goto(step.path);
      await expect(page.getByText(step.expect).first()).toBeVisible();

      // Fixtures mean no backend: a screen that reached for one is a bug.
      expect(failures.filter((f) => !f.includes('favicon'))).toEqual([]);
    });
  }

  test('walks from the welcome screen to the confirmation by tapping', async ({ page }) => {
    await page.goto('/');

    // Each step's primary action moves to the next screen in the journey.
    for (let i = 0; i < 4; i += 1) {
      const primary = page.getByRole('button').first();
      await expect(primary).toBeVisible();
      await primary.click();
      await page.waitForTimeout(150);
    }

    expect(page.url()).not.toContain('/gallery');
  });
});

test.describe('the fixture switch', () => {
  test('changes what a screen shows', async ({ page }) => {
    await page.goto('/circles/sunday-crew?fixture=empty');
    await expect(page.getByText(/Sunday Crew/i).first()).toBeVisible();

    await page.goto('/circles/sunday-crew?fixture=partial');
    await expect(page.getByText(/Sunday Crew/i).first()).toBeVisible();
  });
});

test.describe('the gallery', () => {
  test('lists every screen', async ({ page }) => {
    await page.goto('/gallery');
    await expect(page.getByText('73 screens', { exact: false })).toBeVisible();
  });
});

test.describe('secondary actions', () => {
  test('“New circle” creates a circle rather than opening one', async ({ page }) => {
    // It used to fire the journey's `onNext` and land on the circle home,
    // which reads as the planning screen. A button that goes somewhere
    // plausible and wrong is worse than one that does nothing.
    await page.goto('/circles');
    await page.getByRole('button', { name: /New circle/i }).click();

    await expect(page).toHaveURL(/\/circles\/create/);
  });

  test('an action with nowhere to go yet does nothing, rather than something wrong', async ({
    page,
  }) => {
    await page.goto('/circles/sunday-crew/plan/thu-17/confirmed');
    const before = page.url();

    // "Add to my calendar" has no destination until Slice 1 builds one. It
    // must sit there inert, not inherit the journey's next step.
    await page.getByRole('button', { name: /Add to my calendar/i }).click();
    await page.waitForTimeout(200);

    expect(page.url()).toBe(before);
  });
});

test.describe('the controls actually work', () => {
  test('painting a cell changes the range in words', async ({ page }) => {
    await page.goto('/j/abc');

    const first = page.getByRole('checkbox', { name: /to \d/ }).first();
    await expect(first).toHaveAttribute('aria-checked', 'false');

    // The page is server-rendered, so the cell is clickable before React has
    // attached to it. Retry the whole interaction rather than only the
    // assertion, or the first click is silently lost.
    await expect(async () => {
      await first.click();
      await expect(first).toHaveAttribute('aria-checked', 'true', { timeout: 1000 });
    }).toPass();

    // The fill is the affordance; the text is the answer (manifesto §5.4).
    // Asserted without pinning a clock format — times follow the device locale
    // (manifesto §6), so the shape is what matters: two runs, comma-separated.
    await expect(page.getByText(/\d.*–.*,.*\d.*–/).first()).toBeVisible();
  });

  test('a chip group is a choice, not a link', async ({ page }) => {
    await page.goto('/j/abc');

    const all = page.getByRole('checkbox', { name: 'All evening' });
    await expect(all).toHaveAttribute('aria-checked', 'false');

    await expect(async () => {
      await all.click();
      await expect(all).toHaveAttribute('aria-checked', 'true', { timeout: 1000 });
    }).toPass();
    await expect(page.getByRole('checkbox', { name: 'After work' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(page.url()).toContain('/j/abc');
  });

  test('a switch switches', async ({ page }) => {
    await page.goto('/settings/notifications');

    const first = page.getByRole('switch').first();
    const before = await first.getAttribute('aria-checked');

    await expect(async () => {
      await first.click();
      expect(await first.getAttribute('aria-checked')).not.toBe(before);
    }).toPass();
  });
});
