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

/** The artboard's wording. Replaceable, like the share messages. */
export const EN_PREVIEW_TEMPLATES: PreviewTemplates = {
  title: (circleName) => `${circleName} is finding a time to catch up`,
  description: () => "Pick the times you'd actually be up for. No app needed.",
};

/** "Sunday Crew is finding a time to catch up". */
export function ogTitle(circleName: string, templates: PreviewTemplates): string {
  return templates.title(circleName);
}

/**
 * "Pick the times you'd actually be up for. No app needed."
 *
 * Takes no state, which is the point: the same description for every plan of
 * every circle means there is nothing in it that could be about anyone.
 */
export function ogDescription(templates: PreviewTemplates): string {
  return templates.description();
}
