import { describe, expect, it } from 'vitest';

import { usualSaid } from './words';

describe('the usual, in words', () => {
  it('names one part plainly', () => {
    expect(usualSaid(['weekday_evening'])).toBe(
      'Weekday evenings, from your last plans in this circle.',
    );
  });

  it('joins parts of both kinds of day with "and"', () => {
    expect(usualSaid(['weekday_evening', 'weekend_afternoon'])).toBe(
      'Weekday evenings and weekend afternoons, from your last plans in this circle.',
    );
  });

  it('lists three with commas, in the order of the week and the day', () => {
    expect(usualSaid(['weekend_evening', 'weekday_morning', 'weekday_evening'])).toBe(
      'Weekday mornings, weekday evenings and weekend evenings, from your last plans in this circle.',
    );
  });

  it('collapses a whole day of one kind', () => {
    expect(
      usualSaid(['weekday_morning', 'weekday_afternoon', 'weekday_evening', 'weekend_evening']),
    ).toBe('Any time on weekdays and weekend evenings, from your last plans in this circle.');
  });
});
