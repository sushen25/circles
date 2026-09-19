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
