import type { Database } from '@circles/contracts';
import { describe, expect, it } from 'vitest';

import { t } from './index';

// SUS-184, ADR 0065. The join screen says "This is only what {circle} will call
// you. Your account keeps its own name." That is a claim about what the
// database lets a co-member read, so it is checked against the columns the
// generated types say a co-member can read, not against a belief about them.
type Views = Database['public']['Views'];
type RosterRow = Views['circle_roster']['Row'];

// What circle_roster returns, and so everything a co-member learns about a
// person from the roster. A column added to the view fails the next line at
// compile time until it is listed here on purpose.
const rosterColumns = [
  'circle_id',
  'user_id',
  'display_name_snapshot',
  'role',
  'joined_at',
] as const satisfies readonly (keyof RosterRow)[];
type Unlisted = Exclude<keyof RosterRow, (typeof rosterColumns)[number]>;
const noUnlistedColumn: [Unlisted] extends [never] ? true : false = true;

// No view may hand a co-member the account name again.
type NoProfileView = 'member_profiles' extends keyof Views ? false : true;
const noProfileView: NoProfileView = true;

describe('the join screen says what the database enforces about names', () => {
  const sentence = t('name', 'just_for_this_circle', { circle: 'Sunday Crew' });

  it('promises a circle-only name and an account name that stays private', () => {
    expect(sentence).toBe(
      'This is only what Sunday Crew will call you. Your account keeps its own name.',
    );
  });

  it('is true: the roster carries the circle’s name and no account name', () => {
    expect(noUnlistedColumn).toBe(true);
    expect(noProfileView).toBe(true);
    expect(rosterColumns).toContain('display_name_snapshot');
    expect(rosterColumns).not.toContain('display_name');
  });
});
