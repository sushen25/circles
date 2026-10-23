// @e2e: core
import { expect, test } from './fixtures';
import { signedInAs } from './journeys';
import { expectNothingConnects, watched } from './quiet-people';
import { sessionFor, sql } from './stack';

/**
 * The seed's scenarios (`supabase/seed.sql`), read through the product as the
 * people in them — the local stack a person opens by hand is the one these
 * pin (spec §16: "the seed scenario … updated").
 *
 * **Read, never changed.** Every other live spec makes its own circle; these
 * look at the seed's own, which a reset is the only way to restore. A test
 * here that wrote to one would pass once and then fail against its own
 * leftovers — and change what whoever signs in by hand next finds. Each skips,
 * saying so, when its scenario has been moved on by hand since the last reset.
 * One project: the seed is the same in every browser.
 */

// Seed scenario C, as `supabase/seed.sql` writes it: Uni Mates, Jess's circle,
// where Sam asked quietly and Sam and Maya are keen — two of three.
const UNI_MATES = '00000000-0000-4000-8000-000000000a03';
const UNI_MATES_ASK = '00000000-0000-4000-8000-000000000b03';
const SAM = '00000000-0000-4000-8000-000000000105';
const TOM = '00000000-0000-4000-8000-000000000103';

test('seed scenario C: Tom, who has not answered Uni Mates, is asked without being told who asked or how many are keen', async ({
  page,
}) => {
  test.skip(test.info().project.name !== 'android-chrome', 'the seed is the same in every project');
  const [seeded] = sql(`select p.state, (select count(*) from private.plan_interest i
                          where i.plan_id = p.id and i.user_id = '${TOM}')
                        from public.plans p where p.id = '${UNI_MATES_ASK}'`);
  // CI seeds a fresh stack just before this suite, so there a scenario that is
  // not as written is the seed changing under the test: a failure, not a skip.
  if (process.env.CI) expect(seeded, 'scenario C as the seed writes it').toEqual(['seeking', '0']);
  test.skip(
    seeded?.[0] !== 'seeking' || seeded[1] !== '0',
    'scenario C has moved on since the last reset — `make reset`',
  );

  await signedInAs(page, await sessionFor('tom@example.com'));
  const tom = watched(page, { userId: TOM, name: 'Tom' });
  await page.goto(`/circles/${UNI_MATES}`);
  await expect(page.getByText('Asked quietly')).toBeVisible();
  await page.getByRole('button', { name: 'Take a look' }).click();
  await expect(
    page.getByText(
      /^Someone in Uni Mates would be up for a catch-up in the next 7 days\. Would you\?$/,
    ),
  ).toBeVisible();
  // No count: not "2 of 3", not "2 keen". (Sam's name is on the screen, as
  // every member's is — beside the others', which is the point.)
  await expect(page.getByText(/\b2 (of|are|people|said|keen)\b/)).toHaveCount(0);
  // Read, not answered: the scenario stays as the seed wrote it.
  expectNothingConnects({ userId: SAM }, tom);
});

// Seed scenarios A, B and E, as `supabase/seed.sql` writes them: Sunday Crew
// mid-plan (Maya owns it, Nina is a member), Thursday Regulars about time (Nic
// owns it, Nina and Tom are in it) and Book Club locked in (Maya owns it, Nina
// and Jess are in it).
const SUNDAY_CREW = '00000000-0000-4000-8000-000000000a01';
const THURSDAY_REGULARS = '00000000-0000-4000-8000-000000000a02';
const BOOK_CLUB = '00000000-0000-4000-8000-000000000a05';

/**
 * Seeded plans age: A's deadline is a few days after the reset, E's meetup a
 * fortnight on. CI resets just before the suite, so there a scenario that is
 * not as written is a failure; on a stack opened by hand it is a skip.
 */
function skipUnless(asWritten: boolean, scenario: string) {
  if (process.env.CI) expect(asWritten, `${scenario} as the seed writes it`).toBe(true);
  test.skip(!asWritten, `${scenario} has moved on since the last reset: \`make reset\``);
}
const asked = (planId: string) =>
  sql(`select state in ('collecting','ready') and response_deadline > now()
       from public.plans where id = '${planId}'`)[0]?.[0] === 't';

for (const [who, email] of [
  ['Maya, who owns it,', 'maya@example.com'],
  ['Nina, a member,', 'nina@example.com'],
] as const) {
  test(`seed scenario A: ${who} is given one way into the chat while Sunday Crew is finding a time (SUS-248)`, async ({
    page,
  }) => {
    test.skip(
      test.info().project.name !== 'android-chrome',
      'the seed is the same in every project',
    );
    skipUnless(asked('00000000-0000-4000-8000-000000000b01'), 'scenario A');
    await signedInAs(page, await sessionFor(email));
    await page.goto(`/circles/${SUNDAY_CREW}`);

    // The plan card is titled by its state and shares the plan; nothing else
    // puts anything into the chat.
    await expect(page.getByText('Finding a time').first()).toBeVisible();
    await expect(page.getByText('5 of 6 replied')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Share the plan' })).toBeVisible();
    await expect(page.getByText('Anyone new can join from it too.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add someone' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /link/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: "See how it's looking" })).toBeVisible();
  });
}

test('seed scenario E: Nina, a member of Book Club, can add someone and send the details once it is locked in (SUS-248)', async ({
  page,
}) => {
  test.skip(test.info().project.name !== 'android-chrome', 'the seed is the same in every project');
  skipUnless(
    sql(`select count(*) from public.meetup_confirmations c join public.plans p on p.id = c.plan_id
         where p.circle_id = '${BOOK_CLUB}' and c.status = 'active' and c.ends_at > now()`)[0]?.[0] ===
      '1',
    'scenario E',
  );
  await signedInAs(page, await sessionFor('nina@example.com'));
  await page.goto(`/circles/${BOOK_CLUB}`);

  await expect(page.getByText('Locked in', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send the details' })).toBeVisible();
  await expect(page.getByText('For people already in Book Club.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add someone' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Share the plan' })).toHaveCount(0);
});

test('seed scenario B: Tom, a member of Thursday Regulars, can add someone when it is about time (SUS-248)', async ({
  page,
}) => {
  test.skip(test.info().project.name !== 'android-chrome', 'the seed is the same in every project');
  skipUnless(
    sql(`select last_met_at < now() - interval '3 weeks' from public.circles
         where id = '${THURSDAY_REGULARS}'`)[0]?.[0] === 't',
    'scenario B',
  );
  await signedInAs(page, await sessionFor('tom@example.com'));
  await page.goto(`/circles/${THURSDAY_REGULARS}`);

  await expect(page.getByText('About time for the next one')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add someone' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Plan another' })).toBeVisible();
  // Snooze is the owner's; Tom is not Nic.
  await expect(page.getByRole('button', { name: 'Snooze a month' })).toHaveCount(0);
});
