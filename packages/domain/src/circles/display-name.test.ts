import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { isDuplicateName, isValidDisplayName, normaliseDisplayName } from './display-name.js';

describe('normaliseDisplayName', () => {
  it('collapses whitespace and trims', () => {
    expect(normaliseDisplayName('  Tom   B  ')).toBe('Tom B');
    expect(normaliseDisplayName('Tom\n\tB')).toBe('Tom B');
  });

  it('leaves case alone — people write their own names', () => {
    expect(normaliseDisplayName('tom')).toBe('tom');
    expect(normaliseDisplayName('McDonald')).toBe('McDonald');
  });

  it('is idempotent', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const once = normaliseDisplayName(raw);
        expect(normaliseDisplayName(once)).toBe(once);
      }),
    );
  });
});

describe('isValidDisplayName', () => {
  it('rejects nothing-but-whitespace', () => {
    expect(isValidDisplayName('   ')).toBe(false);
    expect(isValidDisplayName('')).toBe(false);
  });

  it('accepts an ordinary name', () => {
    expect(isValidDisplayName('Priya')).toBe(true);
  });

  it('rejects one long enough to break a members list', () => {
    expect(isValidDisplayName('x'.repeat(41))).toBe(false);
    expect(isValidDisplayName('x'.repeat(40))).toBe(true);
  });
});

describe('isDuplicateName', () => {
  it('ignores case and whitespace', () => {
    expect(isDuplicateName(['Tom'], 'tom')).toBe(true);
    expect(isDuplicateName(['Tom'], '  TOM ')).toBe(true);
  });

  it('ignores accents, because the members list reads the same either way', () => {
    expect(isDuplicateName(['Zoë'], 'Zoe')).toBe(true);
    // However the accent was typed: precomposed, or e plus a combining mark.
    expect(isDuplicateName(['Zoë'], 'Zo\u0308e'.normalize('NFC'))).toBe(true);
  });

  it('ignores marks outside the Latin block too', () => {
    // The rule is combining marks, not Latin accents. Postgres has no Unicode
    // property escapes, so `comparable` and `public.canonical_display_name`
    // enumerate the same blocks — and a name whose marks fall outside the one
    // block anybody thinks of first is exactly where the two used to part
    // company, with the database storing what the domain refuses.
    expect(isDuplicateName(['שָׁלוֹם'], 'שלום')).toBe(true);
    expect(isDuplicateName(['مُحَمَّد'], 'محمد')).toBe(true);
  });

  it('does not flag a genuinely different name', () => {
    expect(isDuplicateName(['Tom'], 'Tomas')).toBe(false);
    expect(isDuplicateName([], 'Tom')).toBe(false);
  });

  it('finds a duplicate anywhere in the list', () => {
    expect(isDuplicateName(['Ann', 'Bo', 'Cy'], 'bo')).toBe(true);
  });

  it('says a name always duplicates itself', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (raw) => {
        fc.pre(normaliseDisplayName(raw).length > 0);
        expect(isDuplicateName([raw], raw)).toBe(true);
      }),
    );
  });
});
