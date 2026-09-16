import { describe, expect, it } from 'vitest';

import type { Database } from './db.generated.js';
import { GuestMemberOption, InvitePreview } from './dtos.js';

/**
 * The DTO and the function it describes, tied together.
 *
 * They came apart once: `guest_members_for_reattach` grew a `circle_id` — without
 * which a client cannot make the call the list exists to set up — and this schema did
 * not, so a client parsing the row through it lost exactly that field. Zod strips
 * what it does not declare, silently, which is the whole hazard of two copies of one
 * shape.
 */

type ListedRow = Database['public']['Functions']['guest_members_for_reattach']['Returns'][number];

describe('GuestMemberOption', () => {
  it('declares every column the function returns', () => {
    // The generated type is the database's own answer. A column added there and not
    // here is a compile error on the next line, not a field that quietly disappears.
    const row: ListedRow = {
      circle_id: '00000000-0000-4000-8000-0000000000c1',
      member_user_id: '00000000-0000-4000-8000-0000000000a1',
      display_name: 'Priya',
    };

    const parsed = GuestMemberOption.parse(row);
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(row).sort());
  });

  it('keeps the circle id a client needs to reattach', () => {
    const parsed = GuestMemberOption.parse({
      circle_id: '00000000-0000-4000-8000-0000000000c1',
      member_user_id: '00000000-0000-4000-8000-0000000000a1',
      display_name: 'Priya',
    });

    expect(parsed.circle_id).toBe('00000000-0000-4000-8000-0000000000c1');
  });

  it('still refuses anything that says whether they have replied', () => {
    // ADR 0006's one explicit constraint on this list. A field that is not declared
    // cannot arrive, and this is the assertion that keeps it undeclared.
    const parsed = GuestMemberOption.parse({
      circle_id: '00000000-0000-4000-8000-0000000000c1',
      member_user_id: '00000000-0000-4000-8000-0000000000a1',
      display_name: 'Priya',
      has_replied: true,
      email_verified: true,
    });

    expect(parsed).not.toHaveProperty('has_replied');
    expect(parsed).not.toHaveProperty('email_verified');
  });
});

type PreviewRow = Database['public']['Functions']['invite_preview']['Returns'][number];

describe('InvitePreview', () => {
  it('declares every column the function returns, and nothing more', () => {
    // Same hazard as above, the other way round: a column the function gained
    // would be stripped here, and a column this schema invented would never
    // arrive.
    const row: PreviewRow = {
      circle_name: 'Sunday Crew',
      inviter_name: 'Maya',
      member_initials: ['M', 'P'],
    };

    expect(Object.keys(InvitePreview.parse(row)).sort()).toEqual(Object.keys(row).sort());
  });

  it('accepts a link whose maker has left the circle', () => {
    // The generated type says `string`; the scalar subquery returns null when the
    // inviter is no longer an active member, and pgTAP proves it does.
    expect(
      InvitePreview.parse({ circle_name: 'Sunday Crew', inviter_name: null, member_initials: [] })
        .inviter_name,
    ).toBeNull();
  });
});
