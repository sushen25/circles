import { z } from 'zod';

import { catalogue, isEventName, type EventName } from './analytics.js';

/**
 * The founder's analytics screen (SUS-166): what `public.founder_analytics`
 * returns, the gates (spec §11.4) and the funnel (§11.2) the screen is laid out
 * from, the named rates, and the pure arithmetic over all of it.
 *
 * **Nothing here can name a person.** The function returns counts, the two
 * halves of a ratio, and one median; the schema below has no field an id could
 * ride in, and `analytics.event_breakdown` has already dropped every identifier
 * and every value that is not a boolean or an enum word, in SQL. The screen is
 * handed what it may show.
 *
 * The decisions the screen displays are made here and not in it: whether a gate
 * is met, not met, or has too few answers to say.
 */

const Count = z.int().nonnegative();

export const NorthStarMonth = z.object({
  month: z.string(),
  activated_circles: Count,
  happened_reported: Count,
  happened_corroborated: Count,
});
export type NorthStarMonth = z.infer<typeof NorthStarMonth>;

/** One gate's numbers. Which fields are present depends on the gate's kind. */
export const GateNumbers = z.object({
  numerator: Count.optional(),
  denominator: Count.optional(),
  count: Count.optional(),
  median_seconds: z.number().nonnegative().nullable().optional(),
  n: Count.optional(),
});
export type GateNumbers = z.infer<typeof GateNumbers>;

/**
 * One row of `analytics.event_breakdown`: an event's count in an ISO week
 * (`field` and `value` null), or its count for one value of one boolean or enum
 * field. A boolean's values are the strings `true` and `false`.
 */
export const EventRow = z.object({
  event_name: z.string(),
  schema_version: z.int().positive(),
  week: z.string(),
  field: z.string().nullable(),
  value: z.string().nullable(),
  events: Count,
});
export type EventRow = z.infer<typeof EventRow>;

export const FounderAnalytics = z.object({
  /** The Monday the period starts on. */
  since: z.string(),
  north_star: z.array(NorthStarMonth),
  gates: z.record(z.string(), GateNumbers),
  counters: z.record(z.string(), Count),
  events: z.array(EventRow),
});
export type FounderAnalytics = z.infer<typeof FounderAnalytics>;

// --- the period -------------------------------------------------------------

export const FOUNDER_PERIODS = [7, 30, 90] as const;
export type FounderPeriod = (typeof FOUNDER_PERIODS)[number];

/** The first day of a period of `days` days ending on `now`, as `YYYY-MM-DD` (UTC). */
export function sinceFor(days: FounderPeriod, now: Date): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

// --- the gates (spec §11.4) ---------------------------------------------------

export type GateKind = 'share' | 'count' | 'median';

export type Gate = {
  id: string;
  cohort: 'founder' | 'external';
  kind: GateKind;
  /** `gt` is "more than": the target is that it is not nothing. */
  comparator: 'gte' | 'lte' | 'lt' | 'gt';
  /** A fraction for a share, a number for a count, seconds for a median. */
  threshold: number;
  /** Fewer answers than this and the gate says "too few to say". */
  minN: number;
  /**
   * The key of `gates` that computes it, or null when nothing does: the screen
   * says "Not measured" and, from copy, what is missing.
   */
  measuredBy: string | null;
};

/** The founder cohort's eight, in the spec's order, then the external cohort's. */
export const GATES: readonly Gate[] = [
  {
    id: 'confirmed_meetup',
    cohort: 'founder',
    kind: 'share',
    comparator: 'gte',
    threshold: 1,
    minN: 3,
    measuredBy: 'confirmed_meetup',
  },
  {
    id: 'unchased',
    cohort: 'founder',
    kind: 'share',
    comparator: 'gte',
    threshold: 0.6,
    minN: 5,
    measuredBy: 'unchased',
  },
  {
    id: 'response_time',
    cohort: 'founder',
    kind: 'median',
    comparator: 'lt',
    threshold: 120,
    minN: 5,
    measuredBy: 'response_time',
  },
  {
    id: 'happened',
    cohort: 'founder',
    kind: 'share',
    comparator: 'gte',
    threshold: 0.7,
    minN: 5,
    measuredBy: 'happened',
  },
  {
    id: 'reattach',
    cohort: 'founder',
    kind: 'share',
    comparator: 'gte',
    threshold: 0.8,
    minN: 5,
    measuredBy: 'reattach',
  },
  {
    id: 'second_meetup',
    cohort: 'founder',
    kind: 'count',
    comparator: 'gte',
    threshold: 1,
    minN: 1,
    measuredBy: 'second_meetup',
  },
  {
    id: 'other_organiser',
    cohort: 'founder',
    kind: 'count',
    comparator: 'gte',
    threshold: 1,
    minN: 1,
    measuredBy: 'other_organiser',
  },
  {
    id: 'email_verified',
    cohort: 'founder',
    kind: 'share',
    comparator: 'gte',
    threshold: 0.5,
    minN: 5,
    measuredBy: 'email_verified',
  },
  {
    id: 'confirm_in_week',
    cohort: 'external',
    kind: 'share',
    comparator: 'gte',
    threshold: 0.5,
    minN: 5,
    measuredBy: 'confirm_in_week',
  },
  {
    id: 'another_in_cadence',
    cohort: 'external',
    kind: 'share',
    comparator: 'gte',
    threshold: 0.3,
    minN: 5,
    measuredBy: 'another_in_cadence',
  },
  {
    id: 'claim_moments',
    cohort: 'external',
    kind: 'share',
    comparator: 'gt',
    threshold: 0,
    minN: 5,
    measuredBy: 'claim_moments',
  },
  // Nothing records which moment an app was opened from, or any price test.
  {
    id: 'app_moments',
    cohort: 'external',
    kind: 'share',
    comparator: 'gt',
    threshold: 0,
    minN: 5,
    measuredBy: null,
  },
  {
    id: 'willingness_to_pay',
    cohort: 'external',
    kind: 'count',
    comparator: 'gte',
    threshold: 1,
    minN: 1,
    measuredBy: null,
  },
];

export type JudgedGate =
  | { status: 'not_measured' }
  | {
      status: 'met' | 'not_met' | 'too_few';
      /** A fraction, a count or seconds, by kind; null when there is nothing to divide. */
      value: number | null;
      numerator: number | null;
      denominator: number | null;
      /** How many it rests on. */
      n: number;
    };

function passes(gate: Gate, value: number): boolean {
  if (gate.comparator === 'gte') return value >= gate.threshold;
  if (gate.comparator === 'lte') return value <= gate.threshold;
  if (gate.comparator === 'lt') return value < gate.threshold;
  return value > gate.threshold;
}

/** Whether a gate is met, not met, or has too few answers to say. */
export function judgeGate(gate: Gate, result: FounderAnalytics): JudgedGate {
  const numbers = gate.measuredBy === null ? undefined : result.gates[gate.measuredBy];
  if (numbers === undefined) return { status: 'not_measured' };

  if (gate.kind === 'count') {
    const count = numbers.count ?? 0;
    return {
      status: passes(gate, count) ? 'met' : 'not_met',
      value: count,
      numerator: count,
      denominator: null,
      n: count,
    };
  }
  if (gate.kind === 'median') {
    const n = numbers.n ?? 0;
    const value = numbers.median_seconds ?? null;
    const status =
      value === null || n < gate.minN ? 'too_few' : passes(gate, value) ? 'met' : 'not_met';
    return { status, value, numerator: null, denominator: null, n };
  }
  const numerator = numbers.numerator ?? 0;
  const denominator = numbers.denominator ?? 0;
  const value = denominator === 0 ? null : numerator / denominator;
  const status =
    value === null || denominator < gate.minN ? 'too_few' : passes(gate, value) ? 'met' : 'not_met';
  return { status, value, numerator, denominator, n: denominator };
}

// --- counting events ----------------------------------------------------------

/** Where a count comes from: an event's own total, or a row count the function returns. */
export type FunnelSource = { event: EventName } | { counter: string };

function eventTotal(result: FounderAnalytics, event: string): number {
  let total = 0;
  for (const row of result.events) {
    if (row.event_name === event && row.field === null) total += row.events;
  }
  return total;
}

function sourceCount(result: FounderAnalytics, source: FunnelSource): number {
  return 'event' in source
    ? eventTotal(result, source.event)
    : (result.counters[source.counter] ?? 0);
}

// --- the funnel (spec §11.2) --------------------------------------------------

export type FunnelStep = {
  id: string;
  source: FunnelSource;
  /** A share of the step before it is shown beside it. */
  ofPrevious?: true;
};
export type FunnelStage = {
  id: string;
  steps: readonly FunnelStep[];
  /** What the spec asks for here that nothing records yet: the screen says so, from copy. */
  hasMissing?: true;
};

export const FUNNEL: readonly FunnelStage[] = [
  {
    id: 'organiser_entry',
    steps: [
      { id: 'draft_started', source: { event: 'organiser_draft_started' } },
      { id: 'gate_shown', source: { event: 'organiser_gate_shown' }, ofPrevious: true },
      { id: 'gate_passed', source: { event: 'organiser_gate_passed' }, ofPrevious: true },
    ],
  },
  {
    id: 'acquisition',
    steps: [
      { id: 'circles_created', source: { counter: 'circles_created' } },
      { id: 'invites_shared', source: { event: 'circle_invite_shared' } },
    ],
  },
  {
    id: 'invitation',
    steps: [
      { id: 'join_opened', source: { event: 'circle_join_opened' } },
      { id: 'joined', source: { event: 'circle_joined' }, ofPrevious: true },
      { id: 'first_answer', source: { counter: 'answers' }, ofPrevious: true },
    ],
  },
  {
    id: 'activation',
    steps: [
      { id: 'circles_made', source: { counter: 'circles_created' } },
      { id: 'activated', source: { counter: 'circles_activated' }, ofPrevious: true },
    ],
  },
  {
    id: 'response',
    steps: [
      { id: 'editor_opened', source: { event: 'availability_started' } },
      { id: 'answered', source: { event: 'availability_submitted' }, ofPrevious: true },
    ],
  },
  {
    id: 'continuity',
    steps: [
      { id: 'session_missing', source: { event: 'session_missing_on_return' } },
      { id: 'reattached', source: { event: 'member_reattached' }, ofPrevious: true },
      { id: 'duplicates_removed', source: { event: 'duplicate_member_removed' } },
    ],
  },
  {
    id: 'decision',
    steps: [
      { id: 'plans_made', source: { counter: 'plans_created' } },
      { id: 'plans_confirmed', source: { counter: 'plans_confirmed' }, ofPrevious: true },
    ],
  },
  {
    id: 'outcome',
    steps: [
      { id: 'confirmed', source: { counter: 'plans_confirmed' } },
      { id: 'reported_happened', source: { counter: 'reported_happened' }, ofPrevious: true },
      { id: 'corroborated', source: { counter: 'corroborated' }, ofPrevious: true },
    ],
  },
  {
    id: 'retention',
    steps: [
      { id: 'second_meetup', source: { counter: 'second_meetup_circles' } },
      { id: 'cadence_prompts', source: { event: 'cadence_prompt_sent' } },
    ],
  },
  {
    // ADR 0041: only server-side aggregates with no user, plan or circle on them.
    // The two unattributed events are counts; the rest of the stage is not
    // recorded anywhere yet (SUS-97, SUS-50).
    id: 'quiet_ask',
    steps: [
      { id: 'asks_created', source: { event: 'quiet_ask_created' } },
      { id: 'interest_answered', source: { event: 'quiet_interest_answered' } },
    ],
    hasMissing: true,
  },
  {
    id: 'growth',
    steps: [
      { id: 'nudges_shown', source: { event: 'app_nudge_shown' } },
      { id: 'nudges_tapped', source: { event: 'app_nudge_tapped' }, ofPrevious: true },
      { id: 'accounts_claimed', source: { event: 'account_claimed' } },
      { id: 'app_opens_linked', source: { event: 'app_first_open_linked' } },
      { id: 'guests_started_circle', source: { event: 'guest_started_circle' } },
    ],
  },
];

export type FunnelStepResult = { id: string; count: number; share: number | null };
export type FunnelStageResult = { id: string; steps: FunnelStepResult[]; hasMissing: boolean };

export function funnelOf(result: FounderAnalytics): FunnelStageResult[] {
  return FUNNEL.map((stage) => {
    let previous: number | undefined;
    const steps = stage.steps.map((step) => {
      const count = sourceCount(result, step.source);
      const share =
        step.ofPrevious === true && previous !== undefined && previous > 0
          ? count / previous
          : null;
      previous = count;
      return { id: step.id, count, share };
    });
    return { id: stage.id, steps, hasMissing: stage.hasMissing === true };
  });
}

// --- the rates ------------------------------------------------------------------

/** An event, optionally narrowed to the rows of one field having one value. */
export type EventFilter = { event: EventName; field?: string; value?: string };

export type Rate = { id: string; numerator: EventFilter; denominator: EventFilter };

/**
 * Named rates, one line each. A rate names events and fields the catalogue
 * declares, and `founderAnalytics.test.ts` fails if it names one that is not.
 */
export const RATES: readonly Rate[] = [
  {
    // SUS-159: "decide from this ticket's usage numbers".
    id: 'previous_times_used',
    numerator: { event: 'availability_submitted', field: 'usual_used', value: 'true' },
    denominator: { event: 'availability_started', field: 'usual_offered', value: 'true' },
  },
  {
    // Spec §5.5: "the share of flexible and more-notice responses".
    id: 'flexible_answers',
    numerator: { event: 'availability_submitted', field: 'status', value: 'flexible' },
    denominator: { event: 'availability_submitted' },
  },
];

function filterCount(result: FounderAnalytics, filter: EventFilter): number {
  if (filter.field === undefined) return eventTotal(result, filter.event);
  let total = 0;
  for (const row of result.events) {
    if (
      row.event_name === filter.event &&
      row.field === filter.field &&
      row.value === filter.value
    ) {
      total += row.events;
    }
  }
  return total;
}

export type RateResult = {
  id: string;
  numerator: number;
  denominator: number;
  value: number | null;
};

export function ratesOf(result: FounderAnalytics): RateResult[] {
  return RATES.map((rate) => {
    const numerator = filterCount(result, rate.numerator);
    const denominator = filterCount(result, rate.denominator);
    return {
      id: rate.id,
      numerator,
      denominator,
      value: denominator === 0 ? null : numerator / denominator,
    };
  });
}

/**
 * Why a filter is not allowed, or undefined when it is: its event must be in
 * the catalogue, its field one that event declares, and its value one that
 * field can hold. Only a boolean or an enum can be split by value.
 */
export function problemWithFilter(filter: {
  event: string;
  field?: string;
  value?: string;
}): string | undefined {
  if (!isEventName(filter.event)) return `${filter.event} is not in the catalogue`;
  if (filter.field === undefined) {
    return filter.value === undefined ? undefined : 'a value needs a field';
  }
  const shape = catalogue[filter.event].payload.shape as Record<string, z.ZodType>;
  const declared = shape[filter.field];
  if (declared === undefined) return `${filter.event} declares no field ${filter.field}`;
  const inner = declared instanceof z.ZodOptional ? declared.unwrap() : declared;
  const allowed =
    inner instanceof z.ZodBoolean
      ? ['true', 'false']
      : inner instanceof z.ZodEnum
        ? (inner.options as string[])
        : undefined;
  if (allowed === undefined) return `${filter.event}.${filter.field} is not a boolean or an enum`;
  if (filter.value === undefined || !allowed.includes(filter.value)) {
    return `${filter.event}.${filter.field} cannot be ${String(filter.value)}`;
  }
  return undefined;
}

// --- feature adoption -------------------------------------------------------------

export type AdoptionField = { field: string; values: { value: string; count: number }[] };
export type Adoption = {
  event: string;
  total: number;
  /** Counts for each ISO week from the period's first, oldest first. */
  weeks: { week: string; count: number }[];
  fields: AdoptionField[];
};

/** Every Monday from the period's first to the last week with an event, so a silent week is a zero. */
function weeksOf(result: FounderAnalytics, until?: string): string[] {
  const lastEvent = result.events.reduce(
    (max, row) => (row.week > max ? row.week : max),
    result.since,
  );
  const last = until !== undefined && until > lastEvent ? until : lastEvent;
  const weeks: string[] = [];
  for (
    let day = new Date(`${result.since}T00:00:00Z`);
    ;
    day = new Date(day.getTime() + 7 * 86_400_000)
  ) {
    const week = day.toISOString().slice(0, 10);
    if (week > last || weeks.length > 60) break;
    weeks.push(week);
  }
  return weeks;
}

/**
 * Every event in the catalogue, in its order, with its weekly counts and its
 * splits. `until` (any day) extends the weeks to the one it falls in, so the
 * quiet weeks at the end of a period are zeros and not missing.
 */
export function adoptionOf(result: FounderAnalytics, until?: string): Adoption[] {
  const weeks = weeksOf(result, until);
  return (Object.keys(catalogue) as EventName[]).map((event) => {
    const rows = result.events.filter((row) => row.event_name === event);
    const byWeek = new Map<string, number>();
    const byField = new Map<string, Map<string, number>>();
    for (const row of rows) {
      if (row.field === null || row.value === null) {
        byWeek.set(row.week, (byWeek.get(row.week) ?? 0) + row.events);
        continue;
      }
      const values = byField.get(row.field) ?? new Map<string, number>();
      values.set(row.value, (values.get(row.value) ?? 0) + row.events);
      byField.set(row.field, values);
    }
    return {
      event,
      total: [...byWeek.values()].reduce((a, b) => a + b, 0),
      weeks: weeks.map((week) => ({ week, count: byWeek.get(week) ?? 0 })),
      fields: [...byField.entries()].map(([field, values]) => ({
        field,
        values: [...values.entries()]
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
      })),
    };
  });
}

/** Whether there is nothing at all to show: no event, no meetup, no row counted. */
export function isEmpty(result: FounderAnalytics): boolean {
  return (
    result.events.length === 0 &&
    result.north_star.length === 0 &&
    Object.values(result.counters).every((n) => n === 0) &&
    Object.values(result.gates).every(
      (g) => (g.denominator ?? 0) === 0 && (g.count ?? 0) === 0 && (g.n ?? 0) === 0,
    )
  );
}
