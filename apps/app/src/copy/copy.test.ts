import { brand } from '@circles/config';
import { describe, expect, it } from 'vitest';

import { en, fill, t } from './index';

describe('the copy file', () => {
  it('holds every screen on the canvas', () => {
    expect(Object.keys(en).length).toBeGreaterThanOrEqual(78);
  });

  it('names no product or domain literally, so a rename stays a config change', () => {
    for (const [screen, strings] of Object.entries(en)) {
      for (const [key, value] of Object.entries(strings)) {
        expect(value as string, `${screen}.${key}`).not.toMatch(new RegExp(`\\b${brand.name}\\b`));
        expect(value as string, `${screen}.${key}`).not.toContain(brand.domain);
      }
    }
  });

  it('offers no marketing anywhere: plan email is the only email (S1-30, spec §5.8)', () => {
    for (const [screen, strings] of Object.entries(en)) {
      for (const [key, value] of Object.entries(strings)) {
        expect(value as string, `${screen}.${key}`).not.toMatch(
          /marketing|newsletter|promotion|special offer|product news/i,
        );
      }
    }
  });

  // S1-28's acceptance criterion, over the words themselves: `copy-voice`
  // lints the file, and this holds whatever the lint's configuration says.
  it('spends at most one exclamation mark, and only on the confirmed screens', () => {
    const found: string[] = [];
    for (const [screen, strings] of Object.entries(en)) {
      for (const [key, value] of Object.entries(strings)) {
        const marks = ((value as string).match(/!/g) ?? []).length;
        for (let i = 0; i < marks; i += 1) found.push(`${screen}.${key}`);
      }
    }
    expect(found.length, found.join(', ')).toBeLessThanOrEqual(1);
    for (const where of found) expect(where).toMatch(/^confirmed/);
  });

  it('leaves no placeholder unfillable', () => {
    const known = new Set([
      'brand',
      'domain',
      'support',
      'circle',
      'inviter',
      'count',
      'name',
      'reference',
      // The availability editor's (S1-25).
      'title',
      'dates',
      'painted',
      'total',
      'what',
      'duration',
      'deadline',
      'zone',
      'day',
      'from',
      'to',
      'label',
      'time',
      // S1-30's.
      'day',
      'address',
      // S1-22's: "Priya and Tom just joined".
      'other',
      // S1-27's: the third name a sentence will hold before it counts instead
      // ("Not Alex, Tom or Sam"), and the two halves of a card's exception
      // line ("Doesn't work for Priya · Alex hasn't answered").
      'third',
      'first',
      'second',
      // S1-23's: the circles list's line, circle home's locked-in card, the
      // about-time sentence, the masked link and the owner's name.
      'line',
      'next',
      'date',
      'going',
      'place',
      'period',
      'tail',
      'owner',
      'detail',
    ]);
    for (const [screen, strings] of Object.entries(en)) {
      for (const [key, value] of Object.entries(strings)) {
        for (const [, name] of (value as string).matchAll(/\{(\w+)\}/g)) {
          expect(known.has(name!), `${screen}.${key} uses {${name}}`).toBe(true);
        }
      }
    }
  });
});

describe('fill', () => {
  it('supplies the brand without being asked', () => {
    expect(fill('What is {brand}?')).toBe(`What is ${brand.name}?`);
  });

  it('leaves an unknown placeholder visible rather than printing "undefined"', () => {
    expect(fill('Waiting on {count} replies')).toBe('Waiting on {count} replies');
  });

  it('takes caller params, and lets them override the defaults', () => {
    expect(fill('{count} of {total} can make it', { count: 5, total: 6 })).toBe(
      '5 of 6 can make it',
    );
    expect(fill('{brand}', { brand: 'Something else' })).toBe('Something else');
  });
});

describe('t', () => {
  it('reads a string by screen and key', () => {
    expect(t('account', 'sign_out')).toBe('Sign out');
  });

  it('fills the brand in on the way out', () => {
    expect(t('linkInvalid', 'what_is_brand')).toBe(`What is ${brand.name}?`);
  });
});
