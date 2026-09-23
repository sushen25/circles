import { describe, expect, it } from 'vitest';

import {
  mayManageCircle,
  mayOrganiseInCircle,
  mayRemoveMember,
  mayStartCircle,
} from './eligibility.js';

/**
 * Two rules that look like one, and the difference is a screen.
 */
describe('starting a circle', () => {
  it('needs a saved place', () => {
    expect(mayStartCircle({ isPermanent: false })).toBe('needs_saved_place');
  });

  it('and nothing else — there is no circle to belong to yet', () => {
    expect(mayStartCircle({ isPermanent: true })).toBe('allowed');
  });
});

describe('organising inside a circle', () => {
  it('needs a saved place', () => {
    expect(mayOrganiseInCircle({ isPermanent: false, isMember: true })).toBe('needs_saved_place');
  });

  it('needs membership as well — §8.2 gates a circle on being in it', () => {
    // The case this exists for: somebody with an account opens a friend's link
    // to a circle they have never joined. Allowing them would open the plan
    // composer and refuse them on submit, after they had filled it in.
    expect(mayOrganiseInCircle({ isPermanent: true, isMember: false })).toBe('needs_membership');
  });

  it('allows a saved-place member', () => {
    expect(mayOrganiseInCircle({ isPermanent: true, isMember: true })).toBe('allowed');
  });

  it('asks for the saved place first when neither holds', () => {
    // Sign-in is a step they can take. "You are not in this circle" is a dead
    // end when they have no identity to be in it with.
    expect(mayOrganiseInCircle({ isPermanent: false, isMember: false })).toBe('needs_saved_place');
  });
});

describe('mayRemoveMember', () => {
  it('lets the owner remove anybody but themselves', () => {
    expect(mayRemoveMember({ viewerIsOwner: true, targetIsOwner: false })).toBe(true);
    expect(mayRemoveMember({ viewerIsOwner: true, targetIsOwner: true })).toBe(false);
  });

  it('lets nobody else remove anybody', () => {
    expect(mayRemoveMember({ viewerIsOwner: false, targetIsOwner: false })).toBe(false);
  });
});

describe('mayManageCircle', () => {
  it('is the owner’s', () => {
    expect(mayManageCircle({ viewerIsOwner: true })).toBe(true);
    expect(mayManageCircle({ viewerIsOwner: false })).toBe(false);
  });
});
