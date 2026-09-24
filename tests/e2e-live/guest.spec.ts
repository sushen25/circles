import { expect, test, type Page } from './fixtures';
import { answerOf, emailContactOf, memberNamed, sundayCrew } from './stack';

/**
 * The guest journey H2 lives or dies on (spec §2.1, §5.1, §6.2; S1-24, S1-25,
 * S1-30): a link tapped in a chat, a name, three evenings, sent, and the email
 * offer turned down — with no account, no permission prompt and no install
 * prompt anywhere on the way.
 *
 * The invite secret is watched for by the suite's guard on every request of
 * every test (`fixtures.ts`); this one also reads the address bar, because the
 * router writing the fragment back is the way it would leak into a screenshot.
 */

/** Anything that looks like a prompt for an account, a permission or an install. */
async function expectNoPrompts(page: Page, dialogs: string[]): Promise<void> {
  expect(dialogs, 'no browser dialog or permission prompt').toEqual([]);
  await expect(page.locator('input[type="email"], input[type="password"]')).toHaveCount(0);
}

test('from the chat to Sent in a name and five taps, and the email offer declined in one', async ({
  page,
}) => {
  const crew = sundayCrew();
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.type());
    void dialog.dismiss();
  });

  await page.goto(`/join#${crew.secret}`);

  // Before any prompt: the circle, who shared it, who is in so far (§5.1).
  await expect(page.getByText('Sunday Crew is finding a time to catch up.')).toBeVisible();
  await expect(page.getByText(/^Maya shared this link\./)).toBeVisible();
  await expect(page.getByText('1 person is in so far')).toBeVisible();
  // The fragment is gone from the address bar as soon as it has been read.
  expect(page.url()).not.toContain('#');

  await page.getByRole('button', { name: 'Choose my times' }).click();
  await page.getByLabel('Your name').fill('Priya');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}$`));
  await expect(page.getByText("Times I'd actually be up for")).toBeVisible();
  await expectNoPrompts(page, dialogs);

  const priya = memberNamed(crew.circleId, 'Priya');
  expect(priya, 'Priya is a member of Sunday Crew').toBeDefined();
  expect(priya?.anonymous, 'as a guest, with no account').toBe(true);

  // Three days and Evening; "I'm easy" stays off, so the answer is the times.
  const days = page.getByRole('group', { name: 'Days in this plan' }).getByRole('button');
  for (const index of [0, 2, 4]) {
    await days.nth(index).click();
    await expect(days.nth(index)).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByRole('checkbox', { name: /^Evening/ }).click();
  await expect(page.getByRole('switch', { name: "I'm easy" })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await expect(page.getByText('3 of 7 days')).toBeVisible();
  await page.getByRole('button', { name: 'Send my times' }).click();

  await expect(page).toHaveURL(new RegExp(`/j/${crew.planCode}/sent$`));
  await expect(page.getByText('Thanks, Priya. Your times are in.')).toBeVisible();
  const answer = answerOf(crew.planId, priya!.userId);
  expect(answer?.status).toBe('windows');
  expect(answer?.windows).toHaveLength(3);

  // The offer is an offer: one tap and it is gone, and nothing is kept.
  await expect(page.getByText('Get updates about this meetup by email')).toBeVisible();
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByText('Get updates about this meetup by email')).toHaveCount(0);
  expect(emailContactOf(priya!.userId)).toBeUndefined();
  await expectNoPrompts(page, dialogs);
});

// The guard's own proof: a request that carries the secret is caught, from a
// page the test did not make itself. The test then takes the catch back out,
// because otherwise the guard would — rightly — fail it.
test('a request carrying the invite secret is caught by the suite', async ({ page, leaks }) => {
  const crew = sundayCrew({ withPlan: false });
  await page.goto('/privacy');
  await page.evaluate(`fetch('/privacy?leak=${crew.secret}').catch(() => undefined)`);
  await expect.poll(() => leaks.length).toBe(1);
  expect(leaks[0]).toMatchObject({ where: 'url' });
  leaks.length = 0;

  // A body is a leak too, anywhere but `redeem-invite`.
  await page.evaluate(
    `fetch('/privacy', { method: 'POST', body: '${crew.secret}' }).catch(() => undefined)`,
  );
  await expect.poll(() => leaks.length).toBe(1);
  expect(leaks[0]).toMatchObject({ where: 'body' });
  leaks.length = 0;
});
