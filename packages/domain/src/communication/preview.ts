/**
 * What a chat shows when the link is pasted (ShareMessages artboard, §5.2).
 *
 * The artboard's own caption is the specification: "Circle name only. Never
 * member names, dates chosen, or anything from a quiet ask." A link preview is
 * fetched by the chat app and rendered to everyone in the thread — including
 * people who are not in the circle — before anybody taps anything.
 *
 * The enforcement is the signature, not a filter. `ogTitle` is given the circle
 * name and nothing else, and `ogDescription` is given nothing at all, so there
 * is no member name or date in scope to leak. A version that took the plan and
 * stripped the sensitive parts would be one forgotten field away from a
 * preview that names who is coming.
 */

export type PreviewTemplates = {
  readonly title: (circleName: string) => string;
  readonly description: () => string;
};

/**
 * The brand doc's "Applied" wording (SUS-98), which replaced the artboard's
 * "No app needed." line. Replaceable, like the share messages.
 */
export const EN_PREVIEW_TEMPLATES: PreviewTemplates = {
  title: (circleName) => `${circleName} is finding a time to catch up`,
  description: () =>
    "Pick the times you'd be up for. About a minute, and nobody sees your calendar.",
};

/**
 * The two words the database may say about a plan next to its circle's name
 * (`public.preview_plan_state`, ADR 0054). A closed set on purpose: a third
 * needs a migration and an ADR, and nothing here takes a date, a place or a
 * person.
 */
export type PlanPreviewState = 'asking' | 'locked_in';

/**
 * The cards a chat can draw (ADR 0054). `asking` and `lockedIn` carry the
 * circle's name; `plan` and `invite` are the generic ones, for a link that does
 * not resolve and for a circle invite, and are worded to be true of any link:
 * they take the product's name and nothing else.
 *
 * `EN_PREVIEW_TEMPLATES` above stays the asking card, so everything that renders
 * it (the in-app mock, the website's hero) is unchanged.
 */
export type PreviewCards = {
  readonly asking: PreviewTemplates;
  readonly lockedIn: PreviewTemplates;
  readonly plan: {
    readonly title: (brandName: string) => string;
    readonly description: () => string;
  };
  readonly invite: {
    readonly title: (brandName: string) => string;
    readonly description: () => string;
  };
};

/**
 * Wording for the founder to approve in review (SUS-151): the locked-in card is
 * the website canvas's; the two generic ones are proposed.
 */
export const EN_PREVIEW_CARDS: PreviewCards = {
  asking: EN_PREVIEW_TEMPLATES,
  lockedIn: {
    title: (circleName) => `${circleName} is locked in`,
    description: () => 'The day, the time, the place, and add to calendar.',
  },
  plan: {
    title: (brandName) => `Plans with friends, on ${brandName}`,
    description: () => 'Open the link to see more.',
  },
  invite: {
    title: (brandName) => `You're invited to a circle on ${brandName}`,
    description: () => "Open the link to see who's in and join.",
  },
};

/**
 * What the lookup found behind a link. `circleName` and `planState` are both
 * null for anything that does not resolve (the database answers no row), so a
 * cancelled plan, an unknown code and a database that could not be reached all
 * draw the same generic card.
 */
export type PreviewSubject = {
  /** `join`, `j` or `p`: the path the link was pasted as. */
  readonly kind: string;
  readonly circleName: string | null;
  readonly planState: PlanPreviewState | null;
};

/**
 * Which card, and what it says. The choice is the pair (link, state) and the
 * only strings in scope are a circle's name and the product's, which is how a
 * card for a confirmed plan can say "locked in" and still cannot say when.
 */
export function previewCopy(
  subject: PreviewSubject,
  brandName: string,
  cards: PreviewCards = EN_PREVIEW_CARDS,
): { title: string; description: string } {
  if (subject.kind === 'join') {
    return { title: cards.invite.title(brandName), description: cards.invite.description() };
  }
  if (subject.circleName === null || subject.planState === null) {
    return { title: cards.plan.title(brandName), description: cards.plan.description() };
  }
  const card = subject.planState === 'locked_in' ? cards.lockedIn : cards.asking;
  return { title: card.title(subject.circleName), description: card.description() };
}

/** "Sunday Crew is finding a time to catch up". */
export function ogTitle(circleName: string, templates: PreviewTemplates): string {
  return templates.title(circleName);
}

/**
 * "Pick the times you'd be up for. About a minute, and nobody sees your calendar."
 *
 * Takes no state, which is the point: the same description for every plan of
 * every circle means there is nothing in it that could be about anyone.
 */
export function ogDescription(templates: PreviewTemplates): string {
  return templates.description();
}
