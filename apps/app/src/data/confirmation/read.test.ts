import { describe, expect, it } from 'vitest';

import { confirmationViewOf, type ConfirmationRead } from './read';

/** Which of the confirmed screens' situations a plan is in (S1-28). */

const thursday: ConfirmationRead = {
  id: 'c1',
  startsAt: '2026-09-17T08:30:00.000Z',
  endsAt: '2026-09-17T10:30:00.000Z',
  placeName: undefined,
  placeUrl: undefined,
  note: undefined,
  status: 'active',
  going: [],
  revision: 1,
  confirmedBy: 'maya',
  confirmedAt: '2026-09-14T09:00:00.000Z',
};

const before = new Date('2026-09-16T00:00:00Z');
const after = new Date('2026-09-17T11:00:00Z');

describe('confirmationViewOf', () => {
  it('is confirmed while the meetup is ahead', () => {
    expect(confirmationViewOf('confirmed', thursday, before)).toBe('confirmed');
  });

  it('has happened once it is over, or once its outcome is in', () => {
    expect(confirmationViewOf('confirmed', thursday, after)).toBe('happened');
    expect(confirmationViewOf('completed', thursday, before)).toBe('happened');
  });

  it('sends a plan that is asking again back to the options', () => {
    expect(confirmationViewOf('collecting', null, before)).toBe('open');
    expect(confirmationViewOf('ready', null, before)).toBe('open');
  });

  it('is over when cancelled or expired', () => {
    expect(confirmationViewOf('cancelled', null, before)).toBe('over');
    expect(confirmationViewOf('expired', null, before)).toBe('over');
  });
});
