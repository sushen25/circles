import { describe, expect, it } from 'vitest';

import { carriesContent, splitRecordable } from './recordable.ts';

describe('carriesContent, which is jobs.carries_content in TypeScript', () => {
  it.each([
    ['a route pattern', '/p/:code'],
    ['an id', '00000000-0000-4000-8000-0000000000f1'],
    ['an instant', '2026-03-01T00:00:00.000Z'],
    ['a zone', 'Australia/Melbourne'],
    ['forty characters', 'a'.repeat(40)],
  ])('lets %s through', (_label, value) => {
    expect(carriesContent({ value })).toBe(false);
  });

  it.each([
    ['a route written as its file', '/p/[code]'],
    ['a route group', '/(auth)/sign-in'],
    ['a space', 'dinner with Maya'],
    ['an address', 'someone@example.com'],
    ['forty-one characters', 'a'.repeat(41)],
    ['the empty string', ''],
    ['a newline at the end', 'abc\n'],
  ])('refuses %s', (_label, value) => {
    expect(carriesContent({ value })).toBe(true);
  });

  it('looks at every depth, and at keys as well as values', () => {
    expect(carriesContent({ a: { b: [{ c: 'dinner with Maya' }] } })).toBe(true);
    expect(carriesContent({ a: { b: ['ok', 'fine'] } })).toBe(false);
    expect(carriesContent({ recipient_email: 'x' })).toBe(true);
    expect(carriesContent({ count: 3, flag: true, nothing: null })).toBe(false);
  });
});

describe('splitRecordable', () => {
  const row = (index: number, properties: Record<string, unknown>, name = 'client_error') => ({
    event_id: String(index),
    event_name: name,
    properties,
  });

  it('records 49 of a batch of 50 and counts one dropped, by name', () => {
    const batch = Array.from({ length: 50 }, (_, index) =>
      row(index, { route: index === 17 ? '/p/[code]' : '/p/:code' }),
    );

    const { keep, dropped } = splitRecordable(batch);

    expect(keep).toHaveLength(49);
    expect(keep.some((kept) => kept.event_id === '17')).toBe(false);
    expect(dropped).toEqual({ client_error: 1 });
  });

  it('counts by event name and keeps nothing of what the event said', () => {
    const { dropped } = splitRecordable([
      row(1, { route: 'dinner with Maya' }),
      row(2, { route: 'dinner with Maya' }, 'plan_created'),
      row(3, { route: 'dinner with Maya' }, 'plan_created'),
    ]);

    expect(dropped).toEqual({ client_error: 1, plan_created: 2 });
    expect(JSON.stringify(dropped)).not.toContain('Maya');
  });
});
