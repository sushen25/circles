import { describe, expect, it } from 'vitest';

import { emailHint, profileView } from './profile';

describe('profileView', () => {
  it("reads the trigger's Guest and UTC as nothing chosen yet", () => {
    expect(profileView({ display_name: 'Guest', time_zone: 'UTC' })).toEqual({
      name: null,
      zone: null,
    });
  });

  it('keeps UTC once the person has named themselves, because they chose it (review round 2)', () => {
    expect(profileView({ display_name: 'Maya', time_zone: 'UTC' })).toEqual({
      name: 'Maya',
      zone: 'UTC',
    });
  });

  it('keeps any other zone either way', () => {
    expect(profileView({ display_name: 'Guest', time_zone: 'Europe/London' }).zone).toBe(
      'Europe/London',
    );
  });
});

describe('the address as Account shows it', () => {
  it('keeps the first character and the domain, and nothing else of the name', () => {
    expect(emailHint('maya@example.com')).toBe('m…@example.com');
    expect(emailHint('m@example.com')).toBe('m…@example.com');
  });

  it('says nothing recognisable about something that is not an address', () => {
    expect(emailHint('not-an-address')).toBe('…');
    expect(emailHint('@example.com')).toBe('…');
  });
});
