import { describe, expect, it } from 'vitest';

import { nameList, numberWord } from './names';

/**
 * The rule ADR 0012 asked for: at six members "Not Alex, Tom or Sam" is a
 * sentence; at twenty it is a list. Three is where it turns into a count.
 */
describe('nameList', () => {
  it('names one, two or three', () => {
    expect(nameList(['Alex'])).toEqual({ kind: 'one', a: 'Alex' });
    expect(nameList(['Alex', 'Tom'])).toEqual({ kind: 'two', a: 'Alex', b: 'Tom' });
    expect(nameList(['Alex', 'Tom', 'Sam'])).toEqual({
      kind: 'three',
      a: 'Alex',
      b: 'Tom',
      c: 'Sam',
    });
  });

  it('counts the rest past three, keeping two names', () => {
    expect(nameList(['Alex', 'Tom', 'Sam', 'Jess'])).toEqual({
      kind: 'many',
      a: 'Alex',
      b: 'Tom',
      rest: 2,
    });
  });

  it('counts the whole of a circle of twenty without naming it', () => {
    const everyone = Array.from({ length: 19 }, (_, i) => `M${i}`);
    expect(nameList(everyone)).toEqual({ kind: 'many', a: 'M0', b: 'M1', rest: 17 });
  });

  it('says nothing about nobody', () => {
    expect(nameList([])).toEqual({ kind: 'none' });
  });
});

describe('numberWord', () => {
  it('writes the counts a circle can produce', () => {
    expect(numberWord(0)).toBe('zero');
    expect(numberWord(5)).toBe('five');
    expect(numberWord(13)).toBe('thirteen');
    expect(numberWord(20)).toBe('twenty');
  });

  it('falls back to digits past the member cap rather than inventing grammar', () => {
    expect(numberWord(21)).toBe('21');
    expect(numberWord(-1)).toBe('-1');
    expect(numberWord(1.5)).toBe('1.5');
  });
});
