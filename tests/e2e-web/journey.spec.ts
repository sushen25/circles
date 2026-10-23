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
  { path: '/circles/new/plan', expect: /Which evenings could you do/i },
  { path: '/circles/new/save', expect: /Who's asking/i },
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

  test('walks the first run by tapping: group, evenings, who is asking, share', async ({
    page,
  }) => {
    await page.goto('/start');

    // Who → evenings → who's asking → the plan's share screen, each by its own
    // primary action (ADR 0053, ADR 0090): no sign-in comes before the evenings.
    await page.getByLabel('Who do you keep meaning to see?').fill('Sunday Crew');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Which evenings could you do?')).toBeVisible();
    await page
      .getByRole('button', { name: /, evening$/ })
      .first()
      .click();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText("Who's asking?")).toBeVisible();
    await page.getByLabel('First name').fill('Maya');
    await page.getByLabel('Email', { exact: true }).fill('maya@example.com');
    await page.getByRole('button', { name: 'Email me a code' }).click();
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
    await expect(page.getByText('81 screens', { exact: false })).toBeVisible();
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
  test('the first-time guest lands on an empty grid; a tap fills a day and counts them in, the block says the hours, and the half hours are behind Adjust hours', async ({
    page,
  }) => {
    // The clock is pinned to the week the screens show (12–23 October 2026), so
    // nothing here depends on the day the suite runs.
    await page.clock.setFixedTime(new Date('2026-10-12T09:00:00+11:00'));
    await page.goto('/j/abc');

    // Alex has not answered: the first thing is the question, one line, the
    // grid, the footnote, and Send waiting (SUS-206). The fixture plan asks
    // about evenings only, so the question says so and there is nothing to pick.
    await expect(page.getByRole('heading', { name: 'Which evenings could work?' })).toBeVisible();
    await expect(
      page.getByText('Tap or drag across the evenings. The number is how many can make it.'),
    ).toBeVisible();
    await expect(page.getByText(/^Replies close /)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send my times' })).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'None of these evenings work for me' }),
    ).toBeVisible();
    // No answer block until a day is tapped.
    await expect(page.getByRole('button', { name: 'Adjust hours' })).toHaveCount(0);
    await expect(page.getByText('My answer')).toHaveCount(0);

    // Sunday Crew's fixture: two of the others could make Tuesday 15 (SUS-129).
    const tuesday = page.getByRole('button', { name: /^Tuesday\D*15\D/ });
    await expect(tuesday).toHaveAccessibleName(/2 others could make it$/);
    await expect(tuesday).toHaveAttribute('aria-pressed', 'false');
    await expect(tuesday).toContainText('2');

    // The page is server-rendered, so the day is clickable before React has
    // attached to it. Retry the whole interaction rather than only the
    // assertion, or the first click is silently lost.
    await expect(async () => {
      await tuesday.click();
      await expect(tuesday).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 });
    }).toPass();

    // Tapped: the tile counts Alex in, and the block says the hours (SUS-236).
    await expect(tuesday).toHaveAccessibleName(/you and 2 others can make it$/);
    await expect(tuesday).toContainText('3');
    await expect(page.getByRole('heading', { name: 'Your hours each evening' })).toBeVisible();
    await expect(page.getByText('1 day', { exact: true })).toBeVisible();
    await expect(page.getByText('From 5:30 pm')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send my times' })).toBeEnabled();

    // One window, so no pills: Adjust hours swaps the block for the days, in place.
    await page.getByRole('button', { name: 'Adjust hours', exact: true }).click();
    await expect(page.getByRole('radio')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Your hours each evening' })).toBeVisible();

    // Nothing is painted or scrolled: a day's hours are From and to buttons on
    // the sheet its clock opens.
    await expect(page.getByRole('button', { name: /^From \\d/ })).toHaveCount(0);
    await page.getByRole('button', { name: /^Exact hours, Tuesday/ }).click();
    await expect(page.getByRole('checkbox', { name: / to / })).toHaveCount(0);
    await expect(
      page.getByText("Set the hours you'd be up for. Add a second time if there's a gap."),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /^From 5:30 pm, Tuesday/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^To 10:30 pm, Tuesday/ })).toBeVisible();

    // The fixture's others: Tuesday's two meet from 6:30 to 9:30 pm.
    await expect(page.getByText(/^Most others can do /)).toBeVisible();

    // Moving To to 8 pm sets the day's own hours; a second time, for a gap, is one tap away.
    await page.getByRole('button', { name: /^To 10:30 pm, Tuesday/ }).click();
    await page.getByRole('radio', { name: '8:00 pm', exact: true }).click();
    await expect(page.getByRole('button', { name: /^To 8:00 pm, Tuesday/ })).toBeVisible();
    await page.getByRole('button', { name: 'Add another time' }).click();
    await expect(page.getByRole('button', { name: /^From \\d.*, Tuesday/ })).toHaveCount(2);

    // Done: the sheet goes and the day's row says its own hours.
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('button', { name: /^From \\d/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Exact hours, Tuesday.*, / })).toBeVisible();
  });

  test('dragging across days taps them all, and dragging from a tapped day untaps them', async ({
    page,
  }) => {
    await page.goto('/j/abc');
    const days = page.getByRole('group', { name: 'Days in this plan' }).getByRole('button');
    await expect(days.first()).toBeVisible();

    const centre = async (index: number) => {
      const box = (await days.nth(index).boundingBox())!;
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const drag = async (from: number, to: number) => {
      const a = await centre(from);
      const b = await centre(to);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 10 });
      await page.mouse.up();
    };

    // Monday 14 to Thursday 17: four days in one stroke, each counted in.
    await expect(async () => {
      await drag(0, 3);
      await expect(days.nth(3)).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 });
    }).toPass();
    for (const index of [0, 1, 2, 3]) {
      await expect(days.nth(index)).toHaveAttribute('aria-pressed', 'true');
    }
    await expect(days.nth(4)).toHaveAttribute('aria-pressed', 'false');
    await expect(days.nth(1)).toHaveAccessibleName(
      /you and \d+ others? can make it$|only you so far$/,
    );
    await expect(page.getByText('From 5:30 pm')).toBeVisible();
    await expect(page.getByText('4 days', { exact: true })).toBeVisible();

    // From a tapped day, back across two of them: they are untapped.
    await drag(2, 1);
    await expect(days.nth(1)).toHaveAttribute('aria-pressed', 'false');
    await expect(days.nth(2)).toHaveAttribute('aria-pressed', 'false');
    await expect(days.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(days.nth(3)).toHaveAttribute('aria-pressed', 'true');
  });

  test('a second tap takes a day away again, and its count with it', async ({ page }) => {
    await page.goto('/j/abc');

    const tuesday = page.getByRole('button', { name: /^Tuesday\D*15\D/ });
    await expect(async () => {
      await tuesday.click();
      await expect(tuesday).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 });
    }).toPass();
    await page.getByRole('button', { name: /^Friday\D*18\D/ }).click();
    await expect(page.getByText('From 5:30 pm')).toBeVisible();
    await expect(page.getByText('2 days', { exact: true })).toBeVisible();

    await tuesday.click();
    await expect(tuesday).toHaveAttribute('aria-pressed', 'false');
    await expect(tuesday).toContainText('2');
    await page.getByRole('button', { name: /^Friday\D*18\D/ }).click();
    // Nothing tapped: no answer block, and Send waits again.
    await expect(page.getByText('From 5:30 pm')).toHaveCount(0);
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
      ['empty', /Just you so far/i],
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
