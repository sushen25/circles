import { describe, expect, it } from 'vitest';

import { ClaimIdentityRequest } from './claim-identity.js';
import { ReattachMemberRequest } from './reattach-member.js';
import { RedeemInviteRequest } from './redeem-invite.js';

/**
 * The boundary's job is to refuse, and these are the refusals that matter: each
 * one is a request that would otherwise reach SQL and come back as a 500 rather
 * than as something a screen can act on.
 */

const KEY = '00000000-0000-4000-8000-000000000001';

describe('RedeemInviteRequest', () => {
  const body = {
    idempotency_key: KEY,
    secret: 'x'.repeat(43),
    display_name: 'Priya',
  };

  it('accepts a join', () => {
    expect(RedeemInviteRequest.safeParse(body).success).toBe(true);
  });

  it('refuses a name of nothing but whitespace', () => {
    // `z.string().min(1)` accepted this, and then
    // `circle_members_name_length` — which is on the *canonical* form —
    // refused it as an unmapped check violation, i.e. a 500.
    expect(RedeemInviteRequest.safeParse({ ...body, display_name: '   ' }).success).toBe(false);
    expect(RedeemInviteRequest.safeParse({ ...body, display_name: '\t\n ' }).success).toBe(false);
  });

  it('refuses a name longer than the database will hold', () => {
    // The old schema allowed 80; the column allows 40 canonical characters.
    expect(RedeemInviteRequest.safeParse({ ...body, display_name: 'a'.repeat(41) }).success).toBe(
      false,
    );
    expect(RedeemInviteRequest.safeParse({ ...body, display_name: 'a'.repeat(40) }).success).toBe(
      true,
    );
  });

  it('measures the name the way the domain does, not in raw characters', () => {
    // Forty characters once whitespace is collapsed, which is the rule
    // `isValidDisplayName` and `canonical_display_name` both state.
    expect(
      RedeemInviteRequest.safeParse({ ...body, display_name: `  ${'a'.repeat(40)}  ` }).success,
    ).toBe(true);
  });

  it('stores the name the way it measures it', () => {
    // The refinement alone validated the collapsed form and passed the original
    // through, so a newline reached the column and a padded forty-character name
    // stored more than forty characters.
    const parsed = RedeemInviteRequest.parse({ ...body, display_name: '  Priya   Sharma \n' });
    expect(parsed.display_name).toBe('Priya Sharma');
  });

  it('refuses a secret too short to be one', () => {
    expect(RedeemInviteRequest.safeParse({ ...body, secret: 'short' }).success).toBe(false);
  });

  it('refuses a join with no idempotency key (ADR 0016)', () => {
    const withoutKey = { secret: body.secret, display_name: body.display_name };
    expect(RedeemInviteRequest.safeParse(withoutKey).success).toBe(false);
  });
});

describe('ReattachMemberRequest', () => {
  const target = '00000000-0000-4000-8000-0000000000a1';
  const circle = '00000000-0000-4000-8000-0000000000c1';
  const token = 'y'.repeat(43);

  it('accepts a membership chosen from the list', () => {
    expect(
      ReattachMemberRequest.safeParse({
        idempotency_key: KEY,
        circle_id: circle,
        target_member_user_id: target,
      }).success,
    ).toBe(true);
  });

  it('accepts a re-entry token on its own', () => {
    expect(
      ReattachMemberRequest.safeParse({ idempotency_key: KEY, reentry_token: token }).success,
    ).toBe(true);
  });

  it('refuses both at once, and neither', () => {
    // A request that can be read two ways is one the server would have to guess
    // at, and the two ways authorise different things.
    expect(
      ReattachMemberRequest.safeParse({
        idempotency_key: KEY,
        circle_id: circle,
        target_member_user_id: target,
        reentry_token: token,
      }).success,
    ).toBe(false);
    expect(ReattachMemberRequest.safeParse({ idempotency_key: KEY }).success).toBe(false);
  });

  it('refuses a membership with no circle to find it in', () => {
    expect(
      ReattachMemberRequest.safeParse({ idempotency_key: KEY, target_member_user_id: target })
        .success,
    ).toBe(false);
  });
});

describe('ClaimIdentityRequest', () => {
  it('takes the replaced session as a token, never as an id', () => {
    // A user id in the body is evidence of nothing; a token that still verifies
    // is the claim. The schema is where that distinction is load-bearing.
    expect(
      ClaimIdentityRequest.safeParse({
        idempotency_key: KEY,
        anonymous_session: 'header.body.signature',
        moment: 'after_answer',
      }).success,
    ).toBe(true);
  });

  it('refuses a moment the analytics catalogue does not know', () => {
    expect(
      ClaimIdentityRequest.safeParse({
        idempotency_key: KEY,
        anonymous_session: 'header.body.signature',
        moment: 'whenever',
      }).success,
    ).toBe(false);
  });
});
