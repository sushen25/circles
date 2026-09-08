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
 * Case- and whitespace-insensitive, and accent-insensitive too: "Zoe" and
 * "Zoë" are the same person to everyone reading the members list, so treating
 * them as distinct would defeat the point of asking.
 */
function comparable(value: string): string {
  return normaliseDisplayName(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase();
}

export function isDuplicateName(existing: readonly string[], candidate: string): boolean {
  const target = comparable(candidate);
  return existing.some((name) => comparable(name) === target);
}
