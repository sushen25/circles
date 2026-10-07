import { describe, expect, it } from 'vitest';

import { catalogue, isUnattributed } from './analytics';
import {
  FOUNDER_PERIODS,
  FUNNEL,
  FounderAnalytics,
  GATES,
  RATES,
  adoptionOf,
  funnelOf,
  isEmpty,
  judgeGate,
  problemWithFilter,
  ratesOf,
  sinceFor,
} from './founderAnalytics';
import { emptyFounderAnalytics, founderAnalyticsFixture } from './founderAnalytics.fixture';

const gate = (id: string) => {
  const found = GATES.find((g) => g.id === id);
  if (found === undefined) throw new Error(id);
  return found;
};

describe('the founder analytics result', () => {
  it('round-trips its fixture, and the empty one', () => {
    expect(FounderAnalytics.parse(founderAnalyticsFixture)).toEqual(founderAnalyticsFixture);
    expect(FounderAnalytics.parse(emptyFounderAnalytics)).toEqual(emptyFounderAnalytics);
  });

  it('has no place for an identifier to ride in: an extra key is dropped, not carried', () => {
    const parsed = FounderAnalytics.parse({
      ...founderAnalyticsFixture,
      events: [
        { ...founderAnalyticsFixture.events[0], user_id: 'u', circle_id: 'c', plan_id: 'p' },
      ],
    });
    expect(Object.keys(parsed.events[0] ?? {}).sort()).toEqual([
      'event_name',
      'events',
      'field',
      'schema_version',
      'value',
      'week',
    ]);
  });

  it('refuses a count that is not one', () => {
    expect(
      FounderAnalytics.safeParse({ ...founderAnalyticsFixture, counters: { a: -1 } }).success,
    ).toBe(false);
  });
});

describe('the rates', () => {
  it('name only events and fields the catalogue declares, and values those fields can hold', () => {
    for (const rate of RATES) {
      expect(problemWithFilter(rate.numerator), `${rate.id} numerator`).toBeUndefined();
      expect(problemWithFilter(rate.denominator), `${rate.id} denominator`).toBeUndefined();
    }
  });

  it('refuse an undeclared event, field or value', () => {
    expect(problemWithFilter({ event: 'not_an_event' })).toMatch(/not in the catalogue/);
    expect(
      problemWithFilter({ event: 'availability_started', field: 'nothing', value: 'true' }),
    ).toMatch(/declares no field/);
    expect(
      problemWithFilter({ event: 'availability_submitted', field: 'status', value: 'maybe' }),
    ).toMatch(/cannot be/);
    expect(
      problemWithFilter({ event: 'availability_submitted', field: 'window_count', value: '3' }),
    ).toMatch(/not a boolean or an enum/);
    expect(problemWithFilter({ event: 'circle_joined', field: 'circle_id', value: 'x' })).toMatch(
      /not a boolean or an enum/,
    );
  });

  it('includes "Previous times used when offered" from the two fields SUS-159 added', () => {
    const rate = RATES.find((r) => r.id === 'previous_times_used');
    expect(rate?.numerator).toEqual({
      event: 'availability_submitted',
      field: 'usual_used',
      value: 'true',
    });
    expect(rate?.denominator).toEqual({
      event: 'availability_started',
      field: 'usual_offered',
      value: 'true',
    });
    const result = ratesOf(founderAnalyticsFixture).find((r) => r.id === 'previous_times_used');
    expect(result).toMatchObject({ numerator: 37, denominator: 41 });
    expect(result?.value).toBeCloseTo(37 / 41);
  });

  it('read null rather than zero when nothing was offered', () => {
    expect(ratesOf(emptyFounderAnalytics).every((r) => r.value === null)).toBe(true);
  });
});

describe('the gates', () => {
  it('are the eight of the founder cohort, then the external ones', () => {
    expect(GATES.filter((g) => g.cohort === 'founder')).toHaveLength(8);
    expect(GATES.slice(0, 8).every((g) => g.cohort === 'founder')).toBe(true);
    expect(new Set(GATES.map((g) => g.id)).size).toBe(GATES.length);
  });

  it('read "not measured" where nothing computes them, however the data looks', () => {
    expect(judgeGate(gate('app_moments'), founderAnalyticsFixture)).toEqual({
      status: 'not_measured',
    });
    expect(judgeGate(gate('willingness_to_pay'), founderAnalyticsFixture)).toEqual({
      status: 'not_measured',
    });
    // A gate the function did not return reads the same, rather than zero.
    expect(judgeGate(gate('unchased'), emptyFounderAnalytics)).toEqual({ status: 'not_measured' });
  });

  it('judge a share against its target, and say when there are too few answers', () => {
    expect(judgeGate(gate('unchased'), founderAnalyticsFixture)).toMatchObject({
      status: 'met',
      n: 12,
    });
    expect(judgeGate(gate('confirmed_meetup'), founderAnalyticsFixture)).toMatchObject({
      status: 'not_met',
    });
    expect(judgeGate(gate('happened'), founderAnalyticsFixture)).toMatchObject({
      status: 'too_few',
      n: 2,
    });
    expect(judgeGate(gate('another_in_cadence'), founderAnalyticsFixture)).toMatchObject({
      status: 'too_few',
      value: null,
    });
  });

  it('judge the median wait, a count and "more than nothing"', () => {
    expect(judgeGate(gate('response_time'), founderAnalyticsFixture)).toMatchObject({
      status: 'met',
      value: 100,
    });
    const slow = {
      ...founderAnalyticsFixture,
      gates: { response_time: { median_seconds: 400, n: 9 } },
    };
    expect(judgeGate(gate('response_time'), slow)).toMatchObject({ status: 'not_met' });
    expect(judgeGate(gate('second_meetup'), founderAnalyticsFixture)).toMatchObject({
      status: 'met',
      n: 1,
    });
    expect(judgeGate(gate('other_organiser'), founderAnalyticsFixture)).toMatchObject({
      status: 'not_met',
    });
    expect(judgeGate(gate('claim_moments'), founderAnalyticsFixture)).toMatchObject({
      status: 'met',
    });
  });
});

describe('the funnel', () => {
  it('names only events the catalogue declares, and none of the unattributed one split', () => {
    for (const stage of FUNNEL) {
      for (const step of stage.steps) {
        if ('event' in step.source) expect(catalogue, step.id).toHaveProperty(step.source.event);
      }
    }
    // The quiet ask's two events are counts, and only counts.
    const quiet = FUNNEL.find((s) => s.id === 'quiet_ask');
    expect(quiet?.steps.every((s) => 'event' in s.source && isUnattributed(s.source.event))).toBe(
      true,
    );
  });

  it('counts from events and from rows, and shows conversion between steps', () => {
    const stages = funnelOf(founderAnalyticsFixture);
    const invitation = stages.find((s) => s.id === 'invitation');
    expect(invitation?.steps.map((s) => s.count)).toEqual([41, 29, 24]);
    expect(invitation?.steps[1]?.share).toBeCloseTo(29 / 41);
    expect(invitation?.steps[0]?.share).toBeNull();
    expect(stages.find((s) => s.id === 'quiet_ask')?.hasMissing).toBe(true);
  });

  it('shows no conversion off a step that is zero', () => {
    const stages = funnelOf(emptyFounderAnalytics);
    expect(stages.flatMap((s) => s.steps).every((s) => s.count === 0 && s.share === null)).toBe(
      true,
    );
  });
});

describe('adoption', () => {
  it('lists every catalogue event, and splits a boolean by value', () => {
    const list = adoptionOf(founderAnalyticsFixture);
    expect(list).toHaveLength(Object.keys(catalogue).length);
    const started = list.find((a) => a.event === 'availability_started');
    expect(started?.total).toBe(153);
    expect(started?.weeks).toEqual([
      { week: '2026-09-07', count: 80 },
      { week: '2026-09-14', count: 73 },
    ]);
    expect(started?.fields).toEqual([
      {
        field: 'usual_offered',
        values: [
          { value: 'false', count: 112 },
          { value: 'true', count: 41 },
        ],
      },
    ]);
    expect(list.find((a) => a.event === 'plan_created')?.total).toBe(0);
  });

  it('puts a new event or field in the list with no change: a field is whatever the rows carry', () => {
    const list = adoptionOf({
      ...founderAnalyticsFixture,
      events: [
        {
          event_name: 'plan_shared',
          schema_version: 1,
          week: '2026-09-07',
          field: 'invented',
          value: 'x',
          events: 2,
        },
      ],
    });
    expect(list.find((a) => a.event === 'plan_shared')?.fields).toEqual([
      { field: 'invented', values: [{ value: 'x', count: 2 }] },
    ]);
  });
});

describe('the period', () => {
  it('is 7, 30 or 90 days back from today, in UTC', () => {
    expect(FOUNDER_PERIODS).toEqual([7, 30, 90]);
    expect(sinceFor(7, new Date('2026-10-07T23:30:00Z'))).toBe('2026-09-30');
    expect(sinceFor(90, new Date('2026-10-07T00:00:00Z'))).toBe('2026-07-09');
  });

  it('knows an empty database', () => {
    expect(isEmpty(emptyFounderAnalytics)).toBe(true);
    expect(isEmpty(founderAnalyticsFixture)).toBe(false);
  });
});
