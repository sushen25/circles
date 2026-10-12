import type { EventRow, FounderAnalytics } from './founderAnalytics.js';

/**
 * A founder's answer for tests and the no-backend build: counts and nothing
 * else, in the scenario's own numbers (usual_offered true 41, false 112).
 */
function total(event: string, week: string, events: number, version = 1): EventRow {
  return { event_name: event, schema_version: version, week, field: null, value: null, events };
}
function split(
  event: string,
  week: string,
  field: string,
  value: string,
  events: number,
): EventRow {
  return { event_name: event, schema_version: 1, week, field, value, events };
}

export const founderAnalyticsFixture: FounderAnalytics = {
  since: '2026-09-07',
  north_star: [
    {
      month: '2026-08-01T00:00:00',
      activated_circles: 3,
      happened_reported: 0,
      happened_corroborated: 0,
    },
    {
      month: '2026-09-01T00:00:00',
      activated_circles: 4,
      happened_reported: 3,
      happened_corroborated: 2,
    },
    {
      month: '2026-10-01T00:00:00',
      activated_circles: 4,
      happened_reported: 5,
      happened_corroborated: 3,
    },
  ],
  // The two cohorts are counted apart (spec §11.4, ADR 0058): the same gate
  // can differ between them, and the screen reads each cohort's own.
  gates: {
    founder: {
      confirmed_meetup: { numerator: 3, denominator: 4 },
      unchased: { numerator: 9, denominator: 12, unanswered: 2 },
      response_time: { median_seconds: 100, n: 18 },
      happened: { numerator: 2, denominator: 2 },
      reattach: { numerator: 7, denominator: 8 },
      second_meetup: { count: 1 },
      other_organiser: { count: 0 },
      email_verified: { numerator: 1, denominator: 3 },
      confirm_in_week: { numerator: 3, denominator: 3 },
      another_in_cadence: { numerator: 0, denominator: 0 },
      claim_moments: { numerator: 2, denominator: 5 },
    },
    external: {
      confirmed_meetup: { numerator: 0, denominator: 1 },
      unchased: { numerator: 0, denominator: 0 },
      response_time: { median_seconds: null, n: 0 },
      happened: { numerator: 0, denominator: 0 },
      reattach: { numerator: 0, denominator: 0 },
      second_meetup: { count: 0 },
      other_organiser: { count: 0 },
      email_verified: { numerator: 0, denominator: 0 },
      confirm_in_week: { numerator: 3, denominator: 6 },
      another_in_cadence: { numerator: 0, denominator: 0 },
      claim_moments: { numerator: 3, denominator: 9 },
    },
  },
  cohort_circles: { founder: 3, external: 3 },
  counters: {
    circles_created: 6,
    circles_activated: 4,
    answers: 24,
    plans_created: 9,
    plans_confirmed: 5,
    reported_happened: 4,
    corroborated: 3,
    second_meetup_circles: 1,
  },
  events: [
    total('circle_join_opened', '2026-09-07', 41),
    total('circle_joined', '2026-09-07', 29),
    total('availability_started', '2026-09-07', 80),
    split('availability_started', '2026-09-07', 'usual_offered', 'true', 21),
    split('availability_started', '2026-09-07', 'usual_offered', 'false', 59),
    total('availability_started', '2026-09-14', 73),
    split('availability_started', '2026-09-14', 'usual_offered', 'true', 20),
    split('availability_started', '2026-09-14', 'usual_offered', 'false', 53),
    total('availability_submitted', '2026-09-07', 50),
    split('availability_submitted', '2026-09-07', 'status', 'windows', 40),
    split('availability_submitted', '2026-09-07', 'status', 'flexible', 10),
    split('availability_submitted', '2026-09-07', 'usual_used', 'true', 17),
    split('availability_submitted', '2026-09-07', 'usual_used', 'false', 33),
    total('availability_submitted', '2026-09-14', 48),
    split('availability_submitted', '2026-09-14', 'status', 'windows', 41),
    split('availability_submitted', '2026-09-14', 'status', 'flexible', 7),
    split('availability_submitted', '2026-09-14', 'usual_used', 'true', 20),
    split('availability_submitted', '2026-09-14', 'usual_used', 'false', 28),
    total('quiet_ask_created', '2026-09-14', 2, 2),
    total('session_missing_on_return', '2026-09-14', 8),
    total('member_reattached', '2026-09-14', 7),
  ],
};

export const emptyFounderAnalytics: FounderAnalytics = {
  since: '2026-09-07',
  north_star: [],
  gates: {},
  cohort_circles: {},
  counters: {},
  events: [],
};
