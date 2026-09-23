import { describe, expect, it } from 'vitest';

import type { UserId } from '../circles/types.js';
import { PRIYA, SAM } from '../scheduling/fixtures.js';
import { type EligibilityContext, recipientsFor } from './eligibility.js';
import { NOBODY_HAS_PUSH, eligibilityContext, sundayCrewMembers } from './fixtures.js';
import type { NotificationKind } from './kinds.js';

/**
 * "Emails about plans you organise" (ADR 00XX): what the switch stops, what it
 * does not, and that it is a gate on email rather than on the person.
 *
 * Sam organises the artboard's plan. Nobody has the app unless a row says so,
 * because the switch is about the case where email is the channel.
 */

const samOff = (id: UserId) => id === SAM;

function context(overrides: Partial<EligibilityContext> = {}): EligibilityContext {
  return eligibilityContext({ hasPushDevice: NOBODY_HAS_PUSH, ...overrides });
}

describe('the organiser-email switch', () => {
  // kind, Sam's switch off?, what Sam receives.
  const table: readonly [NotificationKind, boolean, 'email' | 'nothing'][] = [
    ['options_ready', false, 'email'],
    ['options_ready', true, 'nothing'],
    ['did_it_happen', false, 'email'],
    ['did_it_happen', true, 'nothing'],
    // Still sends: a plan five people answered is waiting on Sam alone.
    ['replies_closed', false, 'email'],
    ['replies_closed', true, 'email'],
    // Its switch is "Nudges to plan the next one", per circle.
    ['about_time', false, 'email'],
    ['about_time', true, 'email'],
  ];

  for (const [kind, off, expected] of table) {
    it(`${off ? 'off' : 'on'}: ${kind} reaches the organiser by ${expected}`, () => {
      const answer = recipientsFor(
        kind,
        context({ mutedOrganiserEmail: off ? samOff : () => false }),
      );
      expect(answer).toEqual(expected === 'nothing' ? [] : [{ userId: SAM, channel: 'email' }]);
    });
  }

  it('stops only email, so an organiser with the app is still pushed', () => {
    // A gate on the channel, not on the person: removing Sam from the audience
    // would also stop the push version once SUS-59 sends one.
    const withApp = context({ hasPushDevice: (id) => id === SAM, mutedOrganiserEmail: samOff });
    expect(recipientsFor('options_ready', withApp)).toEqual([{ userId: SAM, channel: 'push' }]);
    expect(recipientsFor('did_it_happen', withApp)).toEqual([{ userId: SAM, channel: 'push' }]);
  });

  it('belongs to the person it is set on, not to whoever organises', () => {
    // Priya turning hers off says nothing about Sam's letters.
    const priyaOff = context({ mutedOrganiserEmail: (id) => id === PRIYA });
    expect(recipientsFor('options_ready', priyaOff)).toEqual([{ userId: SAM, channel: 'email' }]);
  });

  it('leaves plan-update email alone, which a subscription governs', () => {
    // Priya subscribed to this plan and has turned organiser email off. Her
    // locked-in email is consent she gave per plan, with its own stop link.
    const priya = context({
      actorId: SAM,
      hasPlanEmailSubscription: (id) => id === PRIYA,
      mutedOrganiserEmail: (id) => id === PRIYA,
    });
    expect(recipientsFor('locked_in', priya)).toEqual([{ userId: PRIYA, channel: 'email' }]);
    expect(recipientsFor('did_it_happen_participant', priya)).toEqual([
      { userId: PRIYA, channel: 'email' },
    ]);
  });

  it('does not bring back what the circle mute stops', () => {
    // "Everything from Sunday Crew" means everything, replies closed included.
    const muted = context({
      members: sundayCrewMembers({ [SAM]: { mutedAll: true } }),
      mutedOrganiserEmail: () => false,
    });
    expect(recipientsFor('replies_closed', muted)).toEqual([]);
  });
});
