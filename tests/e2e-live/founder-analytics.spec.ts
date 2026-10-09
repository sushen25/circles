import { expect, test } from './fixtures';
import { signedInAs } from './journeys';
import { signedInAccount, sql, stackConfig } from './stack';

/**
 * The founder's analytics (SUS-166): an allowlisted account sees the north
 * star, the gates, the funnel and the adoption list; anybody else sees the
 * not-found screen, which says nothing that would tell them the route exists.
 *
 * The allowlist is a table, so the test makes its own account and puts it
 * there, and takes it out again: the seed has nobody on it, and a leftover row
 * would be a founder nobody chose.
 */

const NOT_FOUND = 'This link has expired or never existed.';

test('an allowlisted account sees the north star, the gates, the funnel and adoption', async ({
  page,
}) => {
  const founder = await signedInAccount('Sam');
  sql(`insert into private.allowlist (user_id) values ('${founder.userId}')`);
  try {
    await signedInAs(page, founder.stored);
    await page.goto('/founder/analytics');

    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
    await expect(page.getByText('North star', { exact: true })).toBeVisible();
    await expect(page.getByText('Decision gates · founder cohort')).toBeVisible();
    await expect(page.getByText('Decision gates · external cohort')).toBeVisible();
    // A gate nothing computes says so, and what is missing, rather than a zero.
    await expect(page.getByText('Not measured').first()).toBeVisible();
    await expect(page.getByText(/Missing: no price test or payment event/)).toBeVisible();
    await expect(page.getByText('Funnel', { exact: true })).toBeVisible();
    await expect(page.getByText('Feature adoption')).toBeVisible();
    await expect(page.getByText('Previous times used when offered')).toBeVisible();

    // The period applies to every section, and a longer one is asked for again.
    await page.getByRole('checkbox', { name: 'Last 90 days' }).click();
    await expect(page.getByRole('checkbox', { name: 'Last 90 days' })).toBeChecked();
    await expect(page.getByText('North star', { exact: true })).toBeVisible();

    // Nobody is named anywhere on it.
    const text = (await page.locator('body').innerText()) ?? '';
    expect(text).not.toMatch(/@example/);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  } finally {
    sql(`delete from private.allowlist where user_id = '${founder.userId}'`);
  }
});

test('a signed-in account that is not on the allowlist gets the not-found screen', async ({
  page,
}) => {
  const somebody = await signedInAccount('Nina');
  await signedInAs(page, somebody.stored);
  await page.goto('/founder/analytics');

  await expect(page.getByText(NOT_FOUND)).toBeVisible();
  await expect(page.getByText('North star', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/allowlist|not allowed|founder/i)).toHaveCount(0);
});

test('nobody signed in gets the same not-found screen', async ({ page }) => {
  await page.goto('/founder/analytics');
  await expect(page.getByText(NOT_FOUND)).toBeVisible();
  await expect(page.getByText('North star', { exact: true })).toHaveCount(0);
});

test('the function refuses a signed-in user who is not on the allowlist', async () => {
  const somebody = await signedInAccount('Tom');
  const { access_token: token } = JSON.parse(somebody.stored) as { access_token: string };
  const config = stackConfig();
  const response = await fetch(`${config.apiUrl}/rest/v1/rpc/founder_analytics`, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ p_since: '2026-01-01' }),
  });
  expect(response.status).toBe(403);
  expect(await response.text()).not.toMatch(/north_star|gates|counters/);
});
