import type { FounderAnalytics, StallState, StalledRow } from './founderAnalytics.js';

/**
 * Reading the founder analytics by campaign tag and the stalled first plans
 * (SUS-240): pure arithmetic over what `public.founder_analytics` returns, in a
 * file of its own so the screen's contract stays readable.
 */

// --- by campaign tag and stalled first plans (SUS-240) -----------------------------

/** One campaign tag's funnel, for the by-post table: the counts a post can be read by. */
export type PostRow = {
  tag: string;
  circles: number;
  plansShared: number;
  answered: number;
  confirmed: number;
  happened: number;
};

/**
 * The tags seen in the period with the figures the question "which post led
 * anywhere" is asked of: circles made, plans shared, people who answered, plans
 * confirmed and meetups that happened. Busiest first, then by name.
 */
export function postsOf(result: FounderAnalytics): PostRow[] {
  return Object.entries(result.by_source_ref)
    .map(([tag, numbers]) => ({
      tag,
      circles: numbers.counters.circles_created ?? 0,
      plansShared: numbers.events.plan_shared ?? 0,
      answered: numbers.counters.answers ?? 0,
      confirmed: numbers.counters.plans_confirmed ?? 0,
      happened: numbers.counters.reported_happened ?? 0,
    }))
    .sort((a, b) => b.circles - a.circles || a.tag.localeCompare(b.tag));
}

export type StallCohortFilter = StalledRow['cohort'] | 'all';

export type StallWeek = {
  week: string;
  /** One block per source in the week, each with the three states (zeros included). */
  sources: {
    source: string;
    states: Record<
      StallState,
      { circles: number; oldestHours: number; medianHours: number | null }
    >;
  }[];
};

/**
 * The stalled first plans laid out by week, newest first, then source: every
 * source in a week shows all three states, so a state with nobody in it reads
 * as nought rather than missing. Rows of both cohorts are combined for `all`,
 * where the middle age is not shown.
 */
export function stalledOf(
  result: FounderAnalytics,
  cohort: StallCohortFilter = 'all',
): StallWeek[] {
  const weeks = new Map<string, Map<string, StallWeek['sources'][number]['states']>>();
  for (const row of result.stalled) {
    if (cohort !== 'all' && row.cohort !== cohort) continue;
    const sources = weeks.get(row.week) ?? new Map();
    const states =
      sources.get(row.source) ??
      ({
        not_shared: { circles: 0, oldestHours: 0, medianHours: 0 },
        shared_quiet: { circles: 0, oldestHours: 0, medianHours: 0 },
        answered_short: { circles: 0, oldestHours: 0, medianHours: 0 },
      } satisfies StallWeek['sources'][number]['states']);
    const was = states[row.state];
    // Two cohorts' rows for one state fold into one line: the oldest is the
    // older. The middle one cannot be combined from two middles, so it is not
    // shown for a folded line (`null`); one cohort on its own shows it.
    states[row.state] = {
      circles: was.circles + row.circles,
      oldestHours: Math.max(was.oldestHours, row.oldest_hours),
      medianHours: was.circles === 0 ? row.median_hours : null,
    };
    sources.set(row.source, states);
    weeks.set(row.week, sources);
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([week, sources]) => ({
      week,
      sources: [...sources.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([source, states]) => ({ source, states })),
    }));
}

/** How many circles are stalled in the rows shown. */
export function stalledTotal(result: FounderAnalytics, cohort: StallCohortFilter = 'all'): number {
  return result.stalled
    .filter((row) => cohort === 'all' || row.cohort === cohort)
    .reduce((sum, row) => sum + row.circles, 0);
}
