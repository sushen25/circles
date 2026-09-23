/**
 * Names in a sentence, and small numbers in words (spec §5.6, ADR 0012).
 *
 * Pure and copy-free: it decides the *shape* of the sentence, the copy file
 * holds the words. Two rules live here, both of which the member cap of twenty
 * forced a decision on.
 *
 * **Names up to three, then a count.** The artboards were drawn for a circle of
 * six, where "Not Alex, Tom or Sam" names half the group and reads like a
 * sentence. At twenty, seven people missing is an ordinary good option and
 * seven names is a list, not a sentence — so three is the ceiling: one, two or
 * three are named, and beyond that two are named and the rest are counted
 * ("Not Priya, Tom and 5 others"). Two named rather than three, because the
 * count is the point once there is one and "and 5 others" needs room to be read.
 *
 * **Numbers up to twenty in words.** "Thursday looks good for five of you"
 * is the headline's voice; twenty is the member cap, so the list is finite and
 * anything past it falls back to digits rather than inventing grammar.
 */

export type NameList =
  | { kind: 'none' }
  | { kind: 'one'; a: string }
  | { kind: 'two'; a: string; b: string }
  | { kind: 'three'; a: string; b: string; c: string }
  | { kind: 'many'; a: string; b: string; rest: number };

/** Most a sentence names before it starts counting instead. */
export const MAX_NAMED = 3;

export function nameList(names: readonly string[]): NameList {
  const [a, b, c] = names;
  if (a === undefined) return { kind: 'none' };
  if (b === undefined) return { kind: 'one', a };
  if (c === undefined) return { kind: 'two', a, b };
  if (names.length === MAX_NAMED) return { kind: 'three', a, b, c };
  return { kind: 'many', a, b, rest: names.length - 2 };
}

const WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
] as const;

/** `5` → "five". Past the member cap, and for anything odd, the digits. */
export function numberWord(value: number): string {
  if (!Number.isInteger(value) || value < 0) return String(value);
  return WORDS[value] ?? String(value);
}
