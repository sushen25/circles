/**
 * What the group may see of one person's answer, and what the public copy may
 * therefore say about it (spec §5.6 and §8.2, ADR 0066).
 *
 * The rule is a value here, in the domain, because the product keeps two kinds
 * of sentence that have to agree and neither can see the other: the option
 * cards say "Nina can make it" and "Alex hasn't answered", and the privacy
 * page, the site and the answering screens say what the group does and does not
 * see. When one of them changes and the other does not, a public promise is
 * false. `promiseProblems` is the check; the app's copy test feeds it the real
 * sentences and fails on any problem.
 *
 * The rule is **option A** of SUS-189, decided by the founder on 10 October
 * 2026: the group sees, for each option on offer, who can make it, who cannot
 * and who has not answered, and nobody sees anyone's whole availability. Flip
 * a flag and the test names the sentences that are now untrue.
 */
export const answerVisibility = {
  optionCards: {
    /** "{name} can make it". */
    namesWhoCanMake: true,
    /** "Doesn't work for {name}". */
    namesWhoCannot: true,
    /** "{name} hasn't answered". */
    namesWhoHasNotAnswered: true,
    /** A card is a verdict on one stretch; it never shows anybody's windows. */
    showsWindows: false,
  },
  availabilityEditor: {
    /** The counts on the answering screen name nobody (SUS-129, ADR 0045). */
    showsNames: false,
  },
  /** Nobody's whole availability is shown to the group with their name on it. */
  showsWholeAvailabilityWithName: false,
} as const;

export type AnswerVisibility = {
  readonly optionCards: {
    readonly namesWhoCanMake: boolean;
    readonly namesWhoCannot: boolean;
    readonly namesWhoHasNotAnswered: boolean;
    readonly showsWindows: boolean;
  };
  readonly availabilityEditor: { readonly showsNames: boolean };
  readonly showsWholeAvailabilityWithName: boolean;
};

/** What a sentence has to say, in the words a reader would look for. */
export type PromiseKind =
  /** Says the group sees who can make each option, and what it does not see. */
  | 'sees_and_not_sees'
  /** Says who has not answered is shown, quietly, and no more than that. */
  | 'waiting';

export type PromiseSentence = {
  readonly id: string;
  readonly kind: PromiseKind;
  readonly text: string;
};

export type CopyUnderRule = {
  /** The option-card templates that name a person, by copy key. */
  readonly cardTemplates: {
    readonly canMake: readonly string[];
    readonly cannot: readonly string[];
    readonly waiting: readonly string[];
  };
  /** The answering screen's templates (counts), which must name nobody. */
  readonly editorTemplates: readonly string[];
  readonly promises: readonly PromiseSentence[];
};

const NAME = '{name}';
const SEES = /who can make|which (options|times) work for you/i;
const NOT_SEES = /calendar|whole availability|personal schedule/i;
const WAITING = /answered|replied/i;

/**
 * Sentences a promise may not contain when the cards name people: the old
 * absolutes that were false, and the three the audit of 9 October 2026 found.
 */
const FALSE_WHEN_CARDS_NAME_PEOPLE: readonly RegExp[] = [
  /nobody'?s name is ever/i,
  /no one is named/i,
  /nobody in your circle sees your schedule/i,
  /nobody can see one person'?s schedule/i,
  /only (ever )?see a combined result/i,
];

/** Every way the copy and the rule disagree; empty when they agree. */
export function promiseProblems(rule: AnswerVisibility, copy: CopyUnderRule): string[] {
  const problems: string[] = [];
  const cards = rule.optionCards;

  const expect = (templates: readonly string[], names: boolean, what: string): void => {
    for (const template of templates) {
      const has = template.includes(NAME);
      if (names && !has)
        problems.push(`${what} "${template}" should name the person, the rule says it does`);
      if (!names && has)
        problems.push(`${what} "${template}" names a person, the rule says it does not`);
    }
  };
  expect(copy.cardTemplates.canMake, cards.namesWhoCanMake, 'card');
  expect(copy.cardTemplates.cannot, cards.namesWhoCannot, 'card');
  expect(copy.cardTemplates.waiting, cards.namesWhoHasNotAnswered, 'card');
  expect(copy.editorTemplates, rule.availabilityEditor.showsNames, 'answering-screen line');

  const cardsNamePeople =
    cards.namesWhoCanMake || cards.namesWhoCannot || cards.namesWhoHasNotAnswered;

  for (const promise of copy.promises) {
    const { id, kind, text } = promise;
    if (kind === 'sees_and_not_sees') {
      if (cards.namesWhoCanMake && !SEES.test(text)) {
        problems.push(`${id} should say the group sees who can make each option`);
      }
      if (!cards.namesWhoCanMake && SEES.test(text)) {
        problems.push(
          `${id} says the group sees who can make each option, the rule says it does not`,
        );
      }
      if (!rule.showsWholeAvailabilityWithName && !NOT_SEES.test(text)) {
        problems.push(`${id} should say what the group does not see`);
      }
    } else if (cards.namesWhoHasNotAnswered && !WAITING.test(text)) {
      problems.push(`${id} should say the options show who has not answered`);
    }
    if (cardsNamePeople) {
      for (const pattern of FALSE_WHEN_CARDS_NAME_PEOPLE) {
        if (pattern.test(text))
          problems.push(`${id} promises "${pattern.source}", which the cards contradict`);
      }
    }
    if (
      cards.showsWindows === false &&
      /\bsee (your|their) (exact |individual )?(times|windows)\b/i.test(text)
    ) {
      problems.push(`${id} implies the cards show windows`);
    }
  }
  return problems;
}
