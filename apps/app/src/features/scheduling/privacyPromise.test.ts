import { describe, expect, it } from 'vitest';

import {
  answerVisibility,
  promiseProblems,
  type CopyUnderRule,
  type OthersSaid,
  type PromiseSentence,
} from '@circles/domain';

import { en } from '../../copy';
import { cardsOf } from './view';
import * as fixture from './fixtures';

/**
 * The privacy promise and the option cards agree (SUS-189, ADR 0066, spec
 * §5.6 and §8.2).
 *
 * The rule is `answerVisibility` in the domain. This file reads the real copy
 * and the real card builder against it, so the test fails in both directions:
 * the cards are changed to hide names and a promise still says the group sees
 * them, or a promise is rewritten to say names are hidden while the cards still
 * show them.
 */

const keys = (ns: Record<string, string>, prefix: string): string[] =>
  Object.entries(ns)
    .filter(([key]) => key.startsWith(prefix))
    .map(([, value]) => value);

/** Every public sentence about who sees what of someone's answer. */
const promises: PromiseSentence[] = [
  {
    id: 'answering screen notice',
    kind: 'sees_and_not_sees',
    text: en.availability.your_friends_see_who_can_make_each,
  },
  {
    id: 'join page notice',
    kind: 'sees_and_not_sees',
    text: en.main.no_account_or_app_needed_your_friends,
  },
  {
    id: '/privacy, your calendar',
    kind: 'sees_and_not_sees',
    text: en.legal.privacy_calendar_body,
  },
  { id: 'site, promise 2', kind: 'sees_and_not_sees', text: en.site.promise2_body },
  { id: 'site, promise 3', kind: 'waiting', text: en.site.promise3_body },
  // Honest before this ticket and left as it was.
  {
    id: 'settings, privacy',
    kind: 'sees_and_not_sees',
    text: en.privacy.they_see_which_options_work_for_you,
  },
];

const copy: CopyUnderRule = {
  cardTemplates: {
    canMake: keys(en.candidates, 'can_').filter((s) => !s.includes('Nobody')),
    cannot: keys(en.candidates, 'not_'),
    waiting: keys(en.candidates, 'waiting_'),
  },
  // The answering screen's lines about what others said: counts, no names.
  editorTemplates: [
    ...keys(en.availability, 'others_'),
    ...keys(en.availability, 'day_others_'),
    ...keys(en.availability, 'block_'),
    ...keys(en.availability, 'overlap_'),
    ...keys(en.availability, 'peak'),
    ...keys(en.availability, 'cell_'),
  ],
  promises,
};

describe('the privacy promise and the option cards', () => {
  it('agree: no sentence the cards contradict, and no card the sentences deny', () => {
    expect(promiseProblems(answerVisibility, copy)).toEqual([]);
  });

  it('read some real templates, not none', () => {
    expect(copy.cardTemplates.canMake.length).toBeGreaterThanOrEqual(4);
    expect(copy.cardTemplates.cannot.length).toBeGreaterThanOrEqual(4);
    expect(copy.cardTemplates.waiting.length).toBeGreaterThanOrEqual(4);
    expect(copy.editorTemplates.length).toBeGreaterThanOrEqual(10);
  });

  it('describe the card the member really sees: names who can make it, who cannot, who is still to answer', () => {
    const cards = cardsOf(fixture.ready);
    expect(cards.length).toBeGreaterThan(0);
    const names = fixture.ready.roster.map((m) => m.name);
    for (const card of cards) {
      expect(names.some((name) => card.membersLabel.includes(name))).toBe(true);
    }
    const said = cards.map((card) => card.exception ?? '').join(' ');
    expect(said).toContain("hasn't answered");
    expect(said).toContain("Doesn't work for");
  });

  it('keep the cards free of windows: a card holds a verdict, never a time of anyone’s', () => {
    for (const card of cardsOf(fixture.ready)) {
      expect(Object.keys(card).sort()).toEqual(
        [
          'count',
          'date',
          'exception',
          'id',
          'label',
          'members',
          'membersLabel',
          'rank',
          'recommended',
          'time',
        ].sort(),
      );
    }
  });

  it('keep the answering screen’s read free of identity (SUS-129)', () => {
    const shape: Record<keyof OthersSaid, true> = {
      asked: true,
      answered: true,
      withTimes: true,
      flexible: true,
      readerAnswered: true,
      days: true,
    };
    expect(Object.keys(shape)).toEqual([
      'asked',
      'answered',
      'withTimes',
      'flexible',
      'readerAnswered',
      'days',
    ]);
  });
});
