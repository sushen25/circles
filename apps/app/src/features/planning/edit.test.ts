import { fromISO } from '@circles/domain';
import { describe, expect, it } from 'vitest';

import { doorFor } from './doors';
import { changesSomething, editDraftFrom, namesWithYou, resolveEdit } from './edit';
import * as fixture from './fixtures';
import { cancelledDay, cancelledUpdate, reopenedDay } from './messages';
import { reaskWarning } from './words';

/**
 * EditPlan and ChangeTime as data: the request is the difference, a new
 * question moves the deadline to fit, and the warning names exactly the
 * people the preview returned (spec §5.3, §5.7).
 */
const NOW = fromISO(new Date(fixture.FIXTURE_NOW).toISOString());
const plan = fixture.asking;

describe('the edit request', () => {
  it('is nothing at all until something changes', () => {
    const resolved = resolveEdit(plan, editDraftFrom(plan), NOW);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.revision).toEqual({});
    expect(changesSomething(resolved.revision)).toBe(false);
    expect(resolved.asksAgain).toBe(false);
  });

  it('sends a quorum alone as a quorum alone, and asks nobody again', () => {
    const resolved = resolveEdit(plan, { ...editDraftFrom(plan), quorum: 5 }, NOW);
    expect(resolved.ok && resolved.revision).toEqual({ quorum: 5 });
    expect(resolved.ok && resolved.asksAgain).toBe(false);
  });

  it('sends the required list only when it differs as a set', () => {
    const same = resolveEdit(plan, { ...editDraftFrom(plan), required: ['maya'] }, NOW);
    expect(same.ok && same.revision).toEqual({});
    const more = resolveEdit(plan, { ...editDraftFrom(plan), required: ['maya', 'tom'] }, NOW);
    expect(more.ok && more.revision).toEqual({ requiredMemberIds: ['maya', 'tom'] });
  });

  it('moves the deadline with new dates, to the preset default', () => {
    const resolved = resolveEdit(
      plan,
      { ...editDraftFrom(plan), preset: 'next_7_days', custom: undefined, band: undefined },
      NOW,
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.asksAgain).toBe(true);
    expect(resolved.deadlineMoved).toBe(true);
    expect(resolved.revision).toEqual({
      window: { start: '2026-09-15', end: '2026-09-21' },
      responseDeadline: '2026-09-16T00:00:00.000Z',
    });
  });

  it('keeps a deadline that still fits when only the duration changes', () => {
    const resolved = resolveEdit(plan, { ...editDraftFrom(plan), duration: 90 }, NOW);
    expect(resolved.ok && resolved.revision).toEqual({ durationMinutes: 90 });
    expect(resolved.ok && resolved.deadline).toBe(plan.responseDeadline);
  });

  it('gives a reopen a deadline still ahead, even when the old one has gone', () => {
    const gone = { ...fixture.lockedIn, responseDeadline: '2026-09-14T08:00:00.000Z' };
    const resolved = resolveEdit(
      gone,
      { ...editDraftFrom(gone), preset: 'next_14_days', custom: undefined, band: undefined },
      NOW,
      { reopen: true },
    );
    expect(resolved.ok && resolved.revision).toMatchObject({
      reopen: true,
      window: { start: '2026-09-15', end: '2026-09-28' },
      responseDeadline: '2026-09-18T00:00:00.000Z',
    });
  });
});

describe('the re-ask warning', () => {
  const words = { you: 'you', someone: 'Someone' };

  it('names who is asked again and who gets a fresh ask, the reader first as "you"', () => {
    const again = namesWithYou(plan, ['priya', 'maya', 'tom'], words);
    expect(again).toEqual(['you', 'Priya', 'Tom']);
    expect(reaskWarning(again, namesWithYou(plan, ['alex'], words))).toBe(
      'Changing this means you, Priya and Tom will be asked for their times again, and Alex gets a fresh ask. Anything sent for the old times is cleared.',
    );
  });

  it('counts past three names, so twenty people read as a sentence', () => {
    expect(reaskWarning(['you', 'Priya', 'Tom', 'Jess', 'Sam'], ['Alex', 'Ren'])).toBe(
      'Changing this means you, Priya and 3 others will be asked for their times again, and Alex and Ren get a fresh ask. Anything sent for the old times is cleared.',
    );
  });

  it('says "you get", not "you gets", and says when nothing is cleared', () => {
    expect(reaskWarning([], ['you'])).toBe(
      'Changing this means you get a fresh ask. Nobody has answered yet, so nothing is cleared.',
    );
  });
});

describe('which day is off', () => {
  it('names the day a reopen took off the table', () => {
    expect(reopenedDay(fixture.reopened)).toBe('Thursday');
    expect(reopenedDay(fixture.asking)).toBeUndefined();
  });

  it('names the locked-in day of a cancelled plan, and none for one that was still asking', () => {
    expect(cancelledDay(fixture.cancelled)).toBe('Thursday');
    const asking = { ...fixture.cancelled, lastConfirmation: null };
    expect(cancelledDay(asking)).toBeUndefined();
    expect(cancelledUpdate(asking, 'https://circles.test')).toBe(
      "Update: Sunday Crew's catch-up is off. Work thing came up, sorry all. Will try again in October. https://circles.test/p/pnsundaycr",
    );
  });

  it("writes the update with the organiser's note and the plan page", () => {
    expect(cancelledUpdate(fixture.cancelled, 'https://circles.test/')).toBe(
      "Update: Thursday's Sunday Crew catch-up is off. Work thing came up, sorry all. Will try again in October. https://circles.test/p/pnsundaycr",
    );
  });
});

describe("the plan link's doors", () => {
  it('sends a member of a cancelled plan to theirs, and the organiser to theirs', () => {
    expect(doorFor(fixture.cancelledAsMember, undefined)).toEqual({
      pathname: '/p/[code]/cancelled',
      params: { code: 'pnsundaycr' },
    });
    expect(doorFor(fixture.cancelled, undefined)).toEqual({
      pathname: '/circles/[id]/plan/[planId]/cancelled',
      params: { id: 'sunday-crew', planId: 'thu-17' },
    });
  });

  it('says a reopen first to somebody who has not answered the new question', () => {
    expect(doorFor(fixture.reopened, undefined)).toBe('wait');
    expect(doorFor(fixture.reopened, false)).toEqual({
      pathname: '/p/[code]/rescheduled',
      params: { code: 'pnsundaycr' },
    });
    expect(doorFor(fixture.reopened, true)).toBeUndefined();
    expect(doorFor({ ...fixture.reopened, deadlinePassed: true }, false)).toBeUndefined();
    expect(doorFor({ ...fixture.reopened, isOrganiser: true }, false)).toBeUndefined();
  });

  it('leaves an ordinary plan to the link', () => {
    expect(doorFor(fixture.asking, false)).toBeUndefined();
  });
});
