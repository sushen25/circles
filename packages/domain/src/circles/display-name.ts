/**
 * Display names are a snapshot on the membership, chosen by the person joining
 * and shown to everyone else in the circle. Two people called "Tom" in a group
 * of six is a real situation, and the product's answer is to notice it rather
 * than to reject it (the second Tom is asked to add something).
 *
 * Named `display-name.ts` rather than the ticket's `displayName.ts` to match
 * `local-date.ts` and every other file in this package.
 */

/**
 * Collapse whitespace and trim. Nothing else: case is preserved because people
 * write their own names, and "tom" is how someone might genuinely write theirs.
 */
export function normaliseDisplayName(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

export function isValidDisplayName(value: string): boolean {
  const normalised = normaliseDisplayName(value);
  return normalised.length > 0 && normalised.length <= 40;
}

/**
 * The combining marks a decomposed name can carry, enumerated.
 *
 * `\p{Diacritic}` would be shorter and is what this used to say. It is not
 * usable, because the same rule has to exist in SQL — `public.canonical_display_name`
 * backs the unique index that actually prevents two Zoës — and Postgres's regex
 * engine has no Unicode property escapes. An enumerated class is the largest
 * rule both engines can state *identically*, and two engines stating one rule
 * differently is how the database ends up storing a name the domain then
 * refuses.
 *
 * Latin, Cyrillic, Hebrew points, Arabic harakat, Syriac, Thaana, and the three
 * later combining blocks. Kept in step with the SQL by
 * `display-name.test.ts` and `010_circles.sql`, which assert the same pairs.
 */
const COMBINING_MARKS =
  /[\u0300-\u036f\u0483-\u0489\u0591-\u05c7\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0711\u0730-\u074a\u07a6-\u07b0\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20f0\ufe20-\ufe2f]/gu;

/**
 * Case- and whitespace-insensitive, and accent-insensitive too: "Zoe" and
 * "Zoë" are the same person to everyone reading the members list, so treating
 * them as distinct would defeat the point of asking.
 */
function comparable(value: string): string {
  return normaliseDisplayName(value)
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLocaleLowerCase();
}

export function isDuplicateName(existing: readonly string[], candidate: string): boolean {
  const target = comparable(candidate);
  return existing.some((name) => comparable(name) === target);
}
