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
  // The same funnel by the organiser's answer to "How did you hear about
  // {brand}?" (SUS-171): the circles sum to the six above, and `unknown` is an
  // owner who was never asked.
  by_source: {
    friend_group: {
      counters: { circles_created: 2, circles_activated: 2, answers: 12, plans_created: 4 },
      events: { circle_join_opened: 20, circle_joined: 15, availability_submitted: 26 },
    },
    reddit: {
      counters: { circles_created: 2, circles_activated: 1, answers: 5, plans_created: 3 },
      events: { circle_join_opened: 9, circle_joined: 6, availability_submitted: 10 },
    },
    // Arrived on a tagged link (SUS-240): not asked, recorded as `content`.
    content: {
      counters: { circles_created: 1, circles_activated: 0, answers: 2, plans_created: 1 },
      events: { circle_join_opened: 4, circle_joined: 3, availability_submitted: 4 },
    },
    unknown: {
      counters: { circles_created: 1, circles_activated: 1, answers: 7, plans_created: 2 },
      events: { circle_join_opened: 12, circle_joined: 8, availability_submitted: 14 },
    },
  },
  // The same funnel by the campaign tag a link carried (SUS-240): a label for a
  // post, never for a person.
  by_source_ref: {
    'tt-always-the-one-3': {
      counters: {
        circles_created: 3,
        plans_created: 3,
        answers: 5,
        plans_confirmed: 1,
        reported_happened: 1,
      },
      events: { plan_shared: 3, availability_submitted: 6, meetup_confirmed: 1 },
    },
    'rd-rpg-scheduling-boss': {
      counters: { circles_created: 1, plans_created: 1, answers: 0 },
      events: { plan_shared: 1 },
    },
    'cmp-doodle': {
      counters: { circles_created: 1, plans_created: 0 },
      events: {},
    },
  },
  // First plans that have stopped, by the week the circle began (SUS-240).
  stalled: [
    {
      week: '2026-10-12',
      cohort: 'external',
      source: 'content',
      state: 'not_shared',
      circles: 2,
      oldest_hours: 52,
      median_hours: 30,
    },
    {
      week: '2026-10-12',
      cohort: 'external',
      source: 'content',
      state: 'shared_quiet',
      circles: 1,
      oldest_hours: 71,
      median_hours: 71,
    },
    {
      week: '2026-10-12',
      cohort: 'founder',
      source: 'friend_group',
      state: 'answered_short',
      circles: 1,
      oldest_hours: 20,
      median_hours: 20,
    },
    {
      week: '2026-10-05',
      cohort: 'external',
      source: 'reddit',
      state: 'shared_quiet',
      circles: 1,
      oldest_hours: 190,
      median_hours: 190,
    },
  ],
  events: [
    total('organiser_source', '2026-09-07', 5),
    split('organiser_source', '2026-09-07', 'source', 'friend_group', 3),
    split('organiser_source', '2026-09-07', 'source', 'reddit', 2),
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
  by_source: {},
  by_source_ref: {},
  stalled: [],
  events: [],
};
