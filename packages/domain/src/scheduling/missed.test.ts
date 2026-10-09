import { describe, expect, it } from 'vitest';

import { hasMissed } from './missed.js';

describe('hasMissed', () => {
  it('has not, while only the organiser has answered a defaulted quorum of three', () => {
    expect(hasMissed({ quorum: 3, answeredCount: 1, repliesOpen: true })).toBe(false);
  });

  it('has not, while fewer have answered than the quorum', () => {
    expect(hasMissed({ quorum: 3, answeredCount: 2, repliesOpen: true })).toBe(false);
  });

  it('has, once the quorum has answered and nothing reached it', () => {
    expect(hasMissed({ quorum: 3, answeredCount: 3, repliesOpen: true })).toBe(true);
    expect(hasMissed({ quorum: 3, answeredCount: 6, repliesOpen: true })).toBe(true);
  });

  it('has, once replies have closed, however few answered', () => {
    expect(hasMissed({ quorum: 3, answeredCount: 1, repliesOpen: false })).toBe(true);
  });
});
