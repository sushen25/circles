import { describe, expect, it } from 'vitest';

import { answerVisibility, promiseProblems, type CopyUnderRule } from './visibility.js';

const agreeing: CopyUnderRule = {
  cardTemplates: {
    canMake: ['{name} can make it'],
    cannot: ["Doesn't work for {name}"],
    waiting: ["{name} hasn't answered"],
  },
  editorTemplates: ['{count} free'],
  promises: [
    {
      id: 'privacy',
      kind: 'sees_and_not_sees',
      text: 'The group sees who can make each time. Nobody sees your calendar.',
    },
    { id: 'site', kind: 'waiting', text: "Until you've answered, the options say so." },
  ],
};

describe('the answer-visibility rule (option A, ADR 0066)', () => {
  it('is option A: names on the cards, no windows, no names in the editor', () => {
    expect(answerVisibility.optionCards.namesWhoCanMake).toBe(true);
    expect(answerVisibility.optionCards.namesWhoCannot).toBe(true);
    expect(answerVisibility.optionCards.namesWhoHasNotAnswered).toBe(true);
    expect(answerVisibility.optionCards.showsWindows).toBe(false);
    expect(answerVisibility.availabilityEditor.showsNames).toBe(false);
    expect(answerVisibility.showsWholeAvailabilityWithName).toBe(false);
  });

  it('finds nothing wrong when the copy and the rule agree', () => {
    expect(promiseProblems(answerVisibility, agreeing)).toEqual([]);
  });

  it('fails when the cards stop naming people but the promise still says they do', () => {
    const hidden: CopyUnderRule = {
      ...agreeing,
      cardTemplates: {
        canMake: ['{count} can make it'],
        cannot: ['{count} cannot'],
        waiting: ['{count} waiting'],
      },
    };
    expect(promiseProblems(answerVisibility, hidden).length).toBeGreaterThanOrEqual(3);
  });

  it('fails when the rule says the cards hide names but a template still shows them', () => {
    const rule = {
      ...answerVisibility,
      optionCards: { ...answerVisibility.optionCards, namesWhoCanMake: false },
    };
    const problems = promiseProblems(rule, agreeing);
    expect(problems.some((p) => p.includes('names a person'))).toBe(true);
    expect(problems.some((p) => p.includes('says the group sees who can make'))).toBe(true);
  });

  it('fails on a promise that denies the names the cards show', () => {
    for (const text of [
      "Nobody's name is ever beside a time.",
      'No one is named for not replying. The group sees who can make it. Not your calendar.',
      'Nobody in your circle sees your schedule, only which times work for the group.',
    ]) {
      const problems = promiseProblems(answerVisibility, {
        ...agreeing,
        promises: [{ id: 'p', kind: 'sees_and_not_sees', text }],
      });
      expect(problems.length, text).toBeGreaterThan(0);
    }
  });

  it('fails on a promise that does not say what the group does not see', () => {
    const problems = promiseProblems(answerVisibility, {
      ...agreeing,
      promises: [
        { id: 'p', kind: 'sees_and_not_sees', text: 'The group sees who can make each time.' },
      ],
    });
    expect(problems).toEqual(['p should say what the group does not see']);
  });

  it('fails when the answering screen starts to name people', () => {
    const problems = promiseProblems(answerVisibility, {
      ...agreeing,
      editorTemplates: ['{name} is free'],
    });
    expect(problems).toHaveLength(1);
  });
});
