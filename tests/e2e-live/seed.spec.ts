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
