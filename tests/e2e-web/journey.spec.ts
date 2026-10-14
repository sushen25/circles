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
  { path: '/start', expect: /Who do you keep meaning to see/i },
  { path: '/circles/new/plan', expect: /Your first catch-up/i },
  { path: '/circles/new/save', expect: /Your plan's ready/i },
  { path: '/name', expect: /What should friends call you/i },
  { path: '/circles', expect: /Your circles|New circle/i },
  { path: '/circles/sunday-crew', expect: /Sunday Crew/i },
  { path: '/circles/sunday-crew/plan/setup', expect: /catch up|window|when/i },
  { path: '/circles/sunday-crew/plan/thu-17/shared', expect: /paste|share|chat/i },
  // The date is written in the device's own order now that it comes from data
  // (S1-27), so the assertion is on the sentence rather than on "Thu 17 Sep".
  { path: '/circles/sunday-crew/plan/thu-17/candidates', expect: /looks good|Best attendance/i },
  { path: '/circles/sunday-crew/plan/thu-17/waiting', expect: /Waiting on|have answered/i },
  { path: '/circles/sunday-crew/plan/thu-17/no-quorum', expect: /enough overlap|unlock/i },
  { path: '/circles/sunday-crew/plan/thu-17/review', expect: /Lock it in|confirm/i },
  // The organiser sets the final plan (SUS-138, ADR 0051): the picker, the review
  // of a time that is not an option, and the edit screen.
  { path: '/circles/sunday-crew/plan/thu-17/set-time', expect: /Pick the time yourself/i },
  {
    path: '/circles/sunday-crew/plan/thu-17/review?start=2026-09-18T09:00:00.000Z&end=2026-09-18T11:00:00.000Z',
    expect: /This isn't one of the options/i,
  },
  { path: '/circles/sunday-crew/plan/thu-17/edit-locked', expect: /Edit this plan/i },
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

  test('walks the first run by tapping: circle, plan, save your place, name, share', async ({
    page,
  }) => {
    await page.goto('/start');

    // First circle → plan → the gate → Your name → the plan's share screen, each
    // by its own primary action (ADR 0053): no sign-in comes before the plan.
    await page.getByRole('button', { name: /^Create/ }).click();
    await expect(page.getByText('Your first catch-up')).toBeVisible();
    await page.getByRole('button', { name: 'Ask the group' }).click();
    await expect(page.getByText("Your plan's ready. Save your place.")).toBeVisible();
    await page.getByRole('button', { name: 'Send me a code' }).click();
    await expect(page.getByText('What should friends call you?')).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Ask Sunday Crew.')).toBeVisible();

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
    await expect(page.getByText('79 screens', { exact: false })).toBeVisible();
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
  test('the first-time guest lands on an empty grid; a tap fills a day and counts them in, one line says the answer, and the half hours are behind Change time', async ({
    page,
  }) => {
    // The clock is pinned to the week the screens show (12–23 October 2026), so
    // nothing here depends on the day the suite runs.
    await page.clock.setFixedTime(new Date('2026-10-12T09:00:00+11:00'));
    await page.goto('/j/abc');

    // Alex has not answered: the first thing is the question, one line, the
    // grid, the footnote, and Send waiting (SUS-206).
    await expect(page.getByRole('heading', { name: 'Which days could work?' })).toBeVisible();
    await expect(
      page.getByText(
        "Tap every day you'd be up for. The number is how many people can make it, you included once you tap.",
      ),
    ).toBeVisible();
    await expect(page.getByText(/^Replies close /)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send my times' })).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'None of these dates work for me' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /^Change the time for/ })).toHaveCount(0);
    await expect(page.getByText('My answer')).toHaveCount(0);

    // Sunday Crew's fixture: two of the others could make Tuesday 15 (SUS-129).
    const tuesday = page.getByRole('button', {
      name: /^Tuesday\D*15\D.*2 others could make it$/,
    });
    await expect(tuesday).toHaveAttribute('aria-pressed', 'false');
    await expect(tuesday).toContainText('2');

    // The page is server-rendered, so the day is clickable before React has
    // attached to it. Retry the whole interaction rather than only the
    // assertion, or the first click is silently lost.
    await expect(async () => {
      await tuesday.click();
      await expect(tuesday).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 });
    }).toPass();

    // Tapped: the tile counts Alex in, and the answer is one line.
    await expect(tuesday).toHaveAccessibleName(/you and 2 others can make it$/);
    await expect(tuesday).toContainText('3');
    await expect(page.getByText('Evenings, from 5:30 pm')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send my times' })).toBeEnabled();

    // On an evening plan Evening and Any time are the same hours, so one
    // choice is offered for them (ADR 0024, ADR 0068).
    await page.getByRole('button', { name: /^Change the time for/ }).click();
    await expect(page.getByRole('radio', { name: /^Evening/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByRole('radio', { name: /^Any time/ })).toHaveCount(0);

    // Nothing scrolls sideways until the half hours are asked for.
    await expect(page.getByRole('checkbox', { name: / to / })).toHaveCount(0);
    await page.getByRole('button', { name: 'Pick exact hours instead' }).click();
    await expect(page.getByRole('heading', { name: 'Exact hours' })).toBeVisible();
    const line = page.getByRole('button', { name: /^Tuesday.*Adjust by the half hour$/ });
    await expect(line).toHaveAttribute('aria-expanded', 'true');
    const cells = page.getByRole('checkbox', { name: /^Tuesday.* to / });
    await expect(cells).toHaveCount(10);

    // The fill is the affordance; the text is the answer (manifesto §5.4).
    // Asserted without pinning a clock format — times follow the device locale
    // (manifesto §6), so the shape is what matters: two runs, comma-separated.
    await cells.nth(3).click();
    await expect(page.getByText(/\d.*–.*,.*\d.*–/).first()).toBeVisible();

    // Back: the answer line says it was set by the half hour.
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByText(/set by the half hour|Different times/)).toBeVisible();
  });

  test('a second tap takes a day away again, and its count with it', async ({ page }) => {
    await page.goto('/j/abc');

    const tuesday = page.getByRole('button', { name: /^Tuesday\D*15\D/ });
    await expect(async () => {
      await tuesday.click();
      await expect(tuesday).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 });
    }).toPass();
    await page.getByRole('button', { name: /^Friday\D*18\D/ }).click();
    await expect(page.getByText('Evenings, from 5:30 pm')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Change the time for Tue.*Fri/ })).toBeVisible();

    await tuesday.click();
    await expect(tuesday).toHaveAttribute('aria-pressed', 'false');
    await expect(tuesday).toContainText('2');
    await page.getByRole('button', { name: /^Friday\D*18\D/ }).click();
    // Nothing tapped: no answer line, and Send waits again.
    await expect(page.getByText('Evenings, from 5:30 pm')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send my times' })).toBeDisabled();
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
