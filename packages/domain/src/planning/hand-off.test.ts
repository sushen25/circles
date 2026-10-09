import { describe, expect, it } from 'vitest';

import { userId } from '../circles/types.js';
import { handOffRefusal } from './hand-off.js';

const MAYA = userId('user-maya');
const NINA = userId('user-nina');

describe('handOffRefusal', () => {
  it('lets a saved-place member take it over', () => {
    expect(
      handOffRefusal(
        { userId: NINA, isMember: true, isParticipant: true, isPermanent: true },
        MAYA,
      ),
    ).toBe(undefined);
  });

  it('refuses a guest, somebody who has left, and the organiser themselves', () => {
    expect(
      handOffRefusal(
        { userId: NINA, isMember: true, isParticipant: true, isPermanent: false },
        MAYA,
      ),
    ).toBe('requires_saved_place');
    expect(
      handOffRefusal(
        { userId: NINA, isMember: false, isParticipant: true, isPermanent: true },
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
        { userId: NINA, isMember: true, isParticipant: false, isPermanent: true },
        MAYA,
      ),
    ).toBe('not_a_participant');
  });
});
