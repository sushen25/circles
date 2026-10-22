// @e2e: core
import { expect, test, type Page } from './fixtures';
import { signedInAs } from './journeys';
import {
  accountToSignInTo,
  circleOwnedBy,
  memberNamed,
  planFor,
  sessionFor,
  signedInAccount,
  sql,
} from './stack';

/**
 * One way into the chat at a time (SUS-248, ADR 0091), against the real stack:
 * any member adds someone between plans, and only the owner cancels old
 * invitations.
 *
 * The invitation a member is shown is the one `get-invite-link` derives, so each
 * circle starts with the owner cancelling its old invitations from settings,
 * which makes the live one (a circle made directly has none anyone can show).
 */

/** The owner opens settings and cancels old invitations, as they would by hand. */
async function ownerCancelsOldInvitations(page: Page, ownerEmail: string, circleId: string) {
  await signedInAs(page, await sessionFor(ownerEmail));
  await page.goto(`/circles/${circleId}/settings`);
  await page.getByRole('button', { name: 'Cancel old invitations' }).click();
  await page
    .getByLabel('Cancel old invitations?')
    .getByRole('button', { name: 'Cancel them' })
    .click();
  await expect(
    page.getByText('Old invitations cancelled. Add someone makes a new one.'),
  ).toBeVisible();
}

/** A member with a saved place, in the circle already. */
async function memberIn(circleId: string, name: string) {
  const account = await signedInAccount(name);
  sql(`insert into public.circle_members (circle_id, user_id, display_name_snapshot)
       values ('${circleId}', '${account.userId}', '${name}')`);
  return account;
}

test('a member adds someone between plans, and the friend joins from what they sent', async ({
  browser,
  page,
}) => {
  const maya = await accountToSignInTo('Maya');
  const circleId = circleOwnedBy(maya.userId, 'Sunday Crew');
  const nina = await memberIn(circleId, 'Nina');
  // Met five days ago and nothing is running: between catch-ups.
  sql(`update public.circles set last_met_at = now() - interval '5 days' where id = '${circleId}'`);
  await ownerCancelsOldInvitations(page, maya.email, circleId);

  const member = await (await browser.newContext()).newPage();
  await signedInAs(member, nina.stored);
  await member.goto(`/circles/${circleId}`);

  // Nina is not the owner and has nothing running: one way in, and it is hers.
  await expect(member.getByRole('button', { name: 'Add someone' })).toBeVisible();
  await expect(member.getByRole('button', { name: /link/i })).toHaveCount(0);
  await expect(member.getByRole('button', { name: 'Cancel old invitations' })).toHaveCount(0);
  await member.getByRole('button', { name: 'Add someone' }).click();

  await expect(member.getByRole('heading', { name: 'Add someone to Sunday Crew' })).toBeVisible();
  await expect(member.getByText('Their invitation')).toBeVisible();
  await expect(
    member.getByText("They're in as soon as they add a name. No app, no account."),
  ).toBeVisible();
  await expect(member.getByRole('button', { name: 'Share' })).toBeVisible();
  await expect(member.getByRole('button', { name: 'Copy' })).toBeVisible();
  await expect(member.getByText(/reset/i)).toHaveCount(0);

  // What Nina would paste: the invitation's link, which a friend opens.
  const invitation = await member
    .getByText(/\/join#\S+$/)
    .first()
    .innerText();
  const friend = await (await browser.newContext()).newPage();
  await friend.goto(invitation.slice(invitation.indexOf('/join#')));
  await friend.getByRole('button', { name: 'Choose my times' }).click();
  await friend.getByLabel('Your name').fill('Ren');
  await friend.getByRole('button', { name: 'Continue' }).click();
  await expect(friend).toHaveURL(new RegExp(`/circles/${circleId}$`));
  expect(memberNamed(circleId, 'Ren')?.anonymous).toBe(true);
});

test('a member who is not the owner cannot cancel old invitations, whatever she asks of the server', async ({
  browser,
}) => {
  const maya = await accountToSignInTo('Maya');
  const circleId = circleOwnedBy(maya.userId, 'Sunday Crew');
  const nina = await memberIn(circleId, 'Nina');

  const member = await (await browser.newContext()).newPage();
  await signedInAs(member, nina.stored);
  await member.goto(`/circles/${circleId}/settings`);
  await expect(member.getByRole('heading', { name: "Who's in" })).toBeVisible();
  await expect(member.getByRole('button', { name: 'Add someone' })).toBeVisible();
  await expect(member.getByRole('button', { name: 'Cancel old invitations' })).toHaveCount(0);
  expect(
    sql(`select count(*) from public.circle_invites
         where circle_id = '${circleId}' and revoked_at is null`)[0]?.[0],
  ).toBe('0');
});

test('the owner cancels old invitations: the old one stops, the plan already shared keeps working', async ({
  browser,
  page,
}) => {
  const maya = await accountToSignInTo('Maya');
  const circleId = circleOwnedBy(maya.userId, 'Sunday Crew');
  const plan = planFor(circleId, maya.userId);
  // An invitation already in a chat.
  const old = `old${'x'.repeat(48)}`;
  sql(`insert into public.circle_invites (circle_id, secret_hash, created_by)
       values ('${circleId}', extensions.digest('${old}', 'sha256'), '${maya.userId}')`);

  await signedInAs(page, await sessionFor(maya.email));
  await page.goto(`/circles/${circleId}/settings`);
  await page.getByRole('button', { name: 'Cancel old invitations' }).click();
  const sheet = page.getByLabel('Cancel old invitations?');
  await expect(
    sheet.getByText(
      "Add someone messages already sent stop working. Plans you've shared keep working, and everyone in Sunday Crew stays in.",
    ),
  ).toBeVisible();

  // Keeping them changes nothing.
  await sheet.getByRole('button', { name: 'Keep them' }).last().click();
  expect(
    sql(`select count(*) from public.circle_invites
         where circle_id = '${circleId}' and revoked_at is null`)[0]?.[0],
  ).toBe('1');

  await page.getByRole('button', { name: 'Cancel old invitations' }).click();
  await page
    .getByLabel('Cancel old invitations?')
    .getByRole('button', { name: 'Cancel them' })
    .click();
  await expect(
    page.getByText('Old invitations cancelled. Add someone makes a new one.'),
  ).toBeVisible();

  // The old invitation is dead…
  const stranger = await (await browser.newContext()).newPage();
  await stranger.goto(`/join#${old}`);
  await expect(stranger.getByText("This link isn't active any more.")).toBeVisible();
  // …and the plan that was shared still lets a newcomer in.
  const other = await (await browser.newContext()).newPage();
  await other.goto(`/j/${plan.code}`);
  await other.getByLabel('Your name').fill('Ada');
  await other.getByRole('button', { name: 'Continue' }).click();
  await expect(other).toHaveURL(new RegExp(`/j/${plan.code}$`));
  expect(memberNamed(circleId, 'Ada')).toBeDefined();
});
