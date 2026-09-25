import { describe, expect, it } from 'vitest';

import { userId } from '../circles/types.js';
import { handOffRefusal } from './hand-off.js';

const MAYA = userId('user-maya');
const PRIYA = userId('user-priya');

describe('handOffRefusal', () => {
  it('lets a saved-place member take it over', () => {
    expect(
      handOffRefusal(
        { userId: PRIYA, isMember: true, isParticipant: true, isPermanent: true },
        MAYA,
      ),
    ).toBe(undefined);
  });

  it('refuses a guest, somebody who has left, and the organiser themselves', () => {
    expect(
      handOffRefusal(
        { userId: PRIYA, isMember: true, isParticipant: true, isPermanent: false },
        MAYA,
      ),
    ).toBe('requires_saved_place');
    expect(
      handOffRefusal(
        { userId: PRIYA, isMember: false, isParticipant: true, isPermanent: true },
        MAYA,
      ),
    ).toBe('not_a_member');
    expect(
      handOffRefusal(
        { userId: MAYA, isMember: true, isParticipant: true, isPermanent: true },
        MAYA,
      ),
    ).toBe('already_the_organiser');
    // In the circle, but never asked: the plan's letters could not reach them.
    expect(
      handOffRefusal(
        { userId: PRIYA, isMember: true, isParticipant: false, isPermanent: true },
        MAYA,
      ),
    ).toBe('not_a_participant');
  });
});
