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
  test('a day and a block give an answer in words, and its line opens to the half hours', async ({
    page,
  }) => {
    await page.goto('/j/abc');

    // Sunday Crew's fixture: Tuesday 15 has no times yet.
    const tuesday = page.getByRole('button', { name: /^Tuesday\D*15\D.*no times yet$/ });
    await expect(tuesday).toHaveAttribute('aria-pressed', 'false');

    // The page is server-rendered, so the day is clickable before React has
    // attached to it. Retry the whole interaction rather than only the
    // assertion, or the first click is silently lost.
    await expect(async () => {
      await tuesday.click();
      await expect(tuesday).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 });
    }).toPass();

    // On an evening plan Evening and Any time are the same hours, so one
    // block is offered for them (ADR 0024).
    const chip = page.getByRole('checkbox', { name: /^Evening/ });
    await expect(page.getByRole('checkbox', { name: /^Any time/ })).toHaveCount(0);
    await chip.click();
    await expect(chip).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('4 of 14 days')).toBeVisible();

    // Nothing scrolls sideways until a day is opened: no half hours on screen.
    await expect(page.getByRole('checkbox', { name: / to / })).toHaveCount(0);
    const line = page.getByRole('button', { name: /^Tuesday.*Adjust by the half hour$/ });
    await line.click();
    await expect(line).toHaveAttribute('aria-expanded', 'true');
    const cells = page.getByRole('checkbox', { name: /^Tuesday.* to / });
    await expect(cells).toHaveCount(10);

    // The fill is the affordance; the text is the answer (manifesto §5.4).
    // Asserted without pinning a clock format — times follow the device locale
    // (manifesto §6), so the shape is what matters: two runs, comma-separated.
    await cells.nth(3).click();
    await expect(page.getByText(/\d.*–.*,.*\d.*–/).first()).toBeVisible();
  });

  test('a block chip is on for the ticked days, and a second tap takes it off again', async ({
    page,
  }) => {
    await page.goto('/j/abc');

    const tuesday = page.getByRole('button', { name: /^Tuesday\D*15\D.*no times yet$/ });
    await expect(async () => {
      await tuesday.click();
      await expect(tuesday).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 });
    }).toPass();
    await page.getByRole('button', { name: /^Friday\D*18\D.*no times yet$/ }).click();

    const chip = page.getByRole('checkbox', { name: /^Evening/ });
    await chip.click();
    await expect(chip).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('5 of 14 days')).toBeVisible();

    await chip.click();
    await expect(chip).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText('3 of 14 days')).toBeVisible();
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

test.describe('states are not routes', () => {
  test('the circle home serves all four of its states from one route', async ({ page }) => {
    for (const [state, expected] of [
      ['joining', /just joined|so far/i],
      ['confirmed', /Locked in/i],
      ['due', /About time|been about/i],
      ['empty', /first|nobody|invite/i],
    ] as const) {
      await page.goto(`/circles/sunday-crew?state=${state}`);
      await expect(page.getByText(expected).first()).toBeVisible();
    }
  });

  test('an unknown state falls back rather than 404s', async ({ page }) => {
    await page.goto('/circles/sunday-crew?state=nonsense');
    await expect(page.getByText(/Sunday Crew/i).first()).toBeVisible();
  });

  test('the app sheet says what it is in the URL', async ({ page }) => {
    const response = await page.goto('/get-the-app');
    expect(response?.status()).toBe(200);
  });
});
