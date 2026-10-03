import { fromISO, localDate } from '@circles/domain';
import { describe, expect, it } from 'vitest';

import { dateWords } from '../availability/days';
import * as fixture from '../scheduling/fixtures';
import { dateOf } from '../scheduling/words';
import { detailsChanged, editNoticeOf } from './editLocked';
import { fixtureOthers, fixtureStretch } from './fixtureStretch';
import { ownReviewOf } from './ownReview';
import { fieldsOf } from './review';
import { gridDays, lengthWords, optionAt, primaryLabelOf } from './setTime';
import { stretchWords } from './stretch';
import { pickOf, type TimePick } from './time';

/**
 * What the picker, the review and the edit screen say about a time the organiser
 * chose (ADR 0050), against the Sunday Crew: Maya organises, Priya, Tom, Jess and
 * Sam have answered, Alex has not.
 */

const plan = fixture.ready;
const NOW = fromISO('2026-09-10T00:00:00.000Z');
const FRI = { startsAt: '2026-09-18T09:00:00.000Z', endsAt: '2026-09-18T11:00:00.000Z' };
const SAT = { startsAt: '2026-09-19T09:00:00.000Z', endsAt: '2026-09-19T11:00:00.000Z' };
const THU_OPTION = { startsAt: '2026-09-17T08:30:00.000Z', endsAt: '2026-09-17T10:30:00.000Z' };
const OCT = { startsAt: '2026-10-03T09:00:00.000Z', endsAt: '2026-10-03T11:00:00.000Z' };

const fridayPick = pickOf(FRI.startsAt, FRI.endsAt, plan.zone);
const read = (range: { startsAt: string; endsAt: string }) =>
  fixtureStretch(range.startsAt, range.endsAt);

describe("who a time works for, in the cards' own words", () => {
  it('names who can make it, who it does not work for, and who has not answered', () => {
    const words = stretchWords(plan, read(FRI), fridayPick);
    expect(words.count).toBe('2 of 6 can make it');
    // Maya's own times do not cover Friday, so she is among those it does not
    // work for: she follows her own answer like anyone (the founder, 2 Oct).
    expect(words.line).toBe(
      "Priya and Tom can make it · Not you, Jess or Sam · Alex hasn't answered",
    );
    expect(words.notGoing).toEqual(['Jess', 'Sam', 'Alex']);
  });

  it('puts the reader first as "You" when their own times cover it', () => {
    const words = stretchWords(plan, read(SAT), pickOf(SAT.startsAt, SAT.endsAt, plan.zone));
    expect(words.line).toBe(
      "You, Tom and Jess can make it · Doesn't work for Priya or Sam · Alex hasn't answered",
    );
    expect(words.count).toBe('3 of 6 can make it');
  });

  it('says the caution only when it applies: below the number', () => {
    const below = stretchWords(plan, read(FRI), fridayPick);
    expect(below.caution).toBe(
      "That's 2 of you, and this plan asked for at least 4. You can still lock it in. Everyone sees who it works for.",
    );
    // Thursday's option works for five of six, which is not below four.
    const thursday = pickOf(THU_OPTION.startsAt, THU_OPTION.endsAt, plan.zone);
    expect(stretchWords(plan, read(THU_OPTION), thursday).caution).toBeUndefined();
  });

  it('says it for a day the plan never asked about, and says nobody was asked', () => {
    const words = stretchWords(plan, read(OCT), pickOf(OCT.startsAt, OCT.endsAt, plan.zone));
    expect(words.outsidePlanDays).toBe(true);
    expect(words.caution).toBe(
      `The plan never asked about ${dateOf(OCT.startsAt, plan.zone)}. You can still lock it in. Everyone is asked to say whether they can come.`,
    );
    expect(words.line).toBe('Nobody was asked about this day, so nobody has said either way.');
  });
});

describe('the picker', () => {
  const days = (pick: TimePick) =>
    gridDays({ month: '2026-09-01', pick, plan, others: fixtureOthers, now: NOW });

  it('picks one day, fades the days gone and the days too far ahead, and says so', () => {
    const grid = days(fridayPick);
    const day = (n: number) => grid.find((d) => d.number === String(n))!;
    expect(day(18).selected).toBe(true);
    expect(day(18).label).toMatch(/picked$/);
    expect(day(9).disabled).toBe(true);
    expect(day(9).label).toMatch(/already gone$/);
    expect(day(11).disabled).toBe(false);
    const october = gridDays({
      month: '2026-10-01',
      pick: fridayPick,
      plan,
      others: fixtureOthers,
      now: NOW,
    });
    // The plan's last day is the 20th, so the 20th of October is the last allowed.
    expect(october.find((d) => d.number === '20')!.disabled).toBe(false);
    expect(october.find((d) => d.number === '21')!.disabled).toBe(true);
    expect(october.find((d) => d.number === '21')!.label).toMatch(/too far ahead$/);
  });

  it("carries SUS-129's figure on days the others have times on", () => {
    const grid = days(fridayPick);
    const thursday = grid.find((d) => d.number === '17')!;
    expect(thursday.others).toBe('4');
    expect(thursday.label).toBe(
      `${dateWords(localDate('2026-09-17'), 'long')}, 4 others could make some of it`,
    );
    expect(grid.find((d) => d.number === '12')!.others).toBeUndefined();
  });

  it('names the length in words, and whether it is the one the plan asked for', () => {
    expect(lengthWords(30)).toBe('Half an hour');
    expect(lengthWords(60)).toBe('1 hour');
    expect(lengthWords(90)).toBe('1 and a half hours');
    expect(lengthWords(120)).toBe('2 hours');
  });

  it('says "Review Friday", or from the edit screen what it would change to', () => {
    expect(primaryLabelOf(fridayPick, plan, false)).toBe('Review Friday');
    expect(primaryLabelOf(fridayPick, plan, true)).toBe(
      `Use ${dateOf(FRI.startsAt, plan.zone)}, 7–9 pm`,
    );
  });

  it('recognises an option the engine offered, which is locked in as one', () => {
    const thursday = pickOf(THU_OPTION.startsAt, THU_OPTION.endsAt, plan.zone);
    expect(optionAt(plan, thursday)).toBe(plan.candidates[0]!.id);
    expect(optionAt(plan, fridayPick)).toBeUndefined();
    // A near-miss is not on offer.
    expect(optionAt({ ...plan, view: 'no_quorum' }, thursday)).toBeUndefined();
  });
});

describe("the review of a time of the organiser's own", () => {
  it('says one caution, by name, in place of the unanswered warning', () => {
    const view = ownReviewOf(plan, read(FRI), FRI.startsAt, FRI.endsAt);
    expect(view.date).toBe(dateWords(localDate('2026-09-18'), 'long'));
    expect(view.time).toBe('7–9 pm');
    expect(view.summary).toBe("2 of 6 can make it · Not you, Jess or Sam · Alex hasn't answered");
    expect(view.warning).toBe(
      "This isn't one of the options, and the plan asked for at least 4. Jess, Sam and Alex didn't put this time down. They'll see the plan and can say whether they're coming.",
    );
    expect(view.belowQuorum).toBe(true);
  });

  it('says it works for everyone when nobody is left out', () => {
    const all = {
      available: plan.participants,
      cannot: [],
      awaiting: [],
      inputVersion: 5,
      revision: 1,
    };
    const view = ownReviewOf(plan, all, SAT.startsAt, SAT.endsAt);
    expect(view.warning).toBe("This isn't one of the options. It works for everyone.");
    expect(view.summary).toBe('6 of 6 can make it');
  });

  it('says the day when the plan never asked about it', () => {
    const view = ownReviewOf(plan, read(OCT), OCT.startsAt, OCT.endsAt);
    expect(view.warning).toContain(
      `This isn't one of the options, and the plan never asked about ${dateOf(OCT.startsAt, plan.zone)}.`,
    );
    expect(localDate(view.pick.day)).toBe('2026-10-03');
  });
});

describe('what saving an edit would do', () => {
  it('says a new place or note shows straight away and asks nobody', () => {
    expect(editNoticeOf({ moved: false, previousWeekday: 'Friday', asked: [] })).toBe(
      'A new place or note shows for everyone straight away. Nobody has to answer again.',
    );
  });

  it('says who a moved time still works for and who is asked', () => {
    expect(
      editNoticeOf({ moved: true, previousWeekday: 'Friday', asked: ['Priya', 'Sam', 'Alex'] }),
    ).toBe(
      'Everyone sees the new time straight away, with Friday marked as moved. Anyone whose times cover it stays going without doing a thing. Priya, Sam and Alex are asked whether they can come.',
    );
    expect(editNoticeOf({ moved: true, previousWeekday: 'Friday', asked: ['Alex'] })).toMatch(
      /Alex is asked whether they can come\.$/,
    );
    expect(editNoticeOf({ moved: true, previousWeekday: 'Friday', asked: [] })).toMatch(
      /Everyone's times cover it, so nobody has to answer again\.$/,
    );
  });

  it('has something to save only when the place or note is not what the plan has', () => {
    const confirmation = {
      placeName: 'Hope St Radio',
      placeUrl: undefined,
      note: undefined,
    } as never;
    const same = fieldsOf({ placeName: 'Hope St Radio', placeUrl: '', note: '' });
    expect(detailsChanged(same, confirmation)).toBe(false);
    const other = fieldsOf({ placeName: 'Naked for Satan', placeUrl: '', note: '' });
    expect(detailsChanged(other, confirmation)).toBe(true);
    // Clearing a note is a change.
    const cleared = fieldsOf({ placeName: 'Hope St Radio', placeUrl: '', note: '' });
    expect(
      detailsChanged(cleared, { ...(confirmation as object), note: 'Come hungry' } as never),
    ).toBe(true);
  });
});
