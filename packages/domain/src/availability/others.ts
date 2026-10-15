/**
 * What the others have said, for the person answering (SUS-129, ADR 0045).
 *
 * The editor shows, as counts, what the people who have already answered said,
 * so a guest can favour the days and hours that meet the most people. Counts
 * only, at every level: a day, a block of hours on a day, a line of the
 * reader's own answer, and each half hour. Nobody is named.
 *
 * Three rules, settled by the founder on 1 October 2026 and refined on 15
 * October 2026 (SUS-211, ADR 0066), live here and in
 * `public.others_availability`:
 *
 * - **The day counts' threshold is one; the hours' is two.** The figure on a
 *   day shows once at least one other person has answered with times. With
 *   exactly one, the figures are that person's days; that was accepted. What
 *   they were free *within* a day (the hours, and the "Most others are free …"
 *   line made of them) waits until two others have answered with times, and
 *   the database does not send it before. "I'm easy" answers alone meet
 *   neither: they would put the same number on every day, which says nothing
 *   about which day.
 * - **"I'm easy" counts everywhere** (spec §5.6): a flexible answer adds one to
 *   every day, block, overlap and half hour.
 * - **Free means any half hour.** Somebody counts for a block when they have any
 *   half hour inside it, and for a line of the answer when they share any half
 *   hour with it. The plan's duration does not come into it.
 *
 * Pure: the database gives the numbers, how many others gave times on each day,
 * and (from two) each other person's windows on each day, with nothing to say
 * whose they are or to link one day's to another's; this works out every count
 * from them.
 */

import { type Interval, overlaps } from '../shared/interval.js';
import { type LocalDate, localDate } from '../shared/local-date.js';
import { toLocal, type Zone } from '../shared/zone.js';

/** The figure on a day shows once this many others have answered with times. */
export const OTHERS_THRESHOLD = 1;

/**
 * The hours within a day (and anything made of them) show once this many
 * others have answered with times. With one, they would be that person's own
 * hours, day by day.
 */
export const HOURS_THRESHOLD = 2;

/** How many other people gave times on a day (not counting "I'm easy"). */
export type DayCount = { readonly date: LocalDate; readonly count: number };

export type OthersSaid = {
  /** Everyone the plan's current revision is asking, the reader included. */
  readonly asked: number;
  /** How many of the others have answered it, whatever they said. */
  readonly answered: number;
  /** Of those, how many answered with times. */
  readonly withTimes: number;
  /** Of those, how many said "I'm easy". */
  readonly flexible: number;
  /** Whether the reader has an answer in to this revision. */
  readonly readerAnswered: boolean;
  /**
   * For each day any other person gave times on, how many did. Empty below
   * the day threshold, and never counts the reader's own answer.
   */
  readonly dayCounts: readonly DayCount[];
  /**
   * One entry per other person per day they gave times on: that person's
   * windows on that day. In no particular order, and nothing links an entry to
   * a person or to the same person's entry on another day. Empty below the
   * hours threshold (two others with times), and never holds the reader's own
   * answer.
   */
  readonly days: readonly (readonly Interval[])[];
};

/** Whether the days have anything to count: the threshold, as the database applies it. */
export function othersShown(others: OthersSaid): boolean {
  return others.withTimes >= OTHERS_THRESHOLD && others.dayCounts.length > 0;
}

/**
 * Whether the hours within a day may be shown, as the database applies it. The
 * client asks as well, but the database does not send them below this, so a
 * screen that forgot to ask would still have nothing to show.
 */
export function hoursShown(others: OthersSaid): boolean {
  return others.withTimes >= HOURS_THRESHOLD && others.days.length > 0;
}

/**
 * How many others could make a day, for the figure on its tile: everyone who
 * said "I'm easy", and each person who gave times on it. Counts from
 * `dayCounts`, so it needs no hours.
 */
export function dayFreeCount(others: OthersSaid, date: LocalDate): number {
  const found = others.dayCounts.find((entry) => entry.date === date);
  return others.flexible + (found?.count ?? 0);
}

/**
 * The day counts that a list of per-person-per-day windows gives, as the
 * database works them out (the local day each person's windows start on).
 * For fixtures and tests: the app reads `dayCounts` from the database.
 */
export function dayCountsOf(days: readonly (readonly Interval[])[], z: Zone): DayCount[] {
  const counts = new Map<string, number>();
  for (const windows of days) {
    const first = windows[0];
    if (first === undefined) continue;
    const date = toLocal(first.start, z).date;
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, count]) => ({ date: localDate(date), count }));
}

/**
 * How many others are free for any of `spans`: everyone who said "I'm easy",
 * and each person with a half hour in common with one of them.
 *
 * Asked about one day at a time. An entry is one person's day, so spans across
 * two days would count somebody free on both of them twice.
 */
export function freeFor(others: OthersSaid, spans: readonly Interval[]): number {
  if (spans.length === 0) return 0;
  const people = others.days.filter((windows) =>
    windows.some((window) => spans.some((span) => overlaps(window, span))),
  ).length;
  return others.flexible + people;
}

/**
 * The number on a day's tile (SUS-206): how many people could make the day.
 * Before the reader taps it that is the others alone; once they tap it, they
 * are one of the people who can, so it is one more, and untapping gives the
 * same number back. A sum of the aggregate the database already returns and
 * the reader's own choice, so it needs nothing new from the server and names
 * nobody.
 */
export function headcount(othersFree: number, readerIncluded: boolean): number {
  return Math.max(0, othersFree) + (readerIncluded ? 1 : 0);
}

/** How many others are free in each of a day's cells. */
export function cellCounts(others: OthersSaid, cells: readonly Interval[]): number[] {
  return cells.map((cell) => freeFor(others, [cell]));
}

/**
 * The most others free in any one half hour of a day, and where: the runs of
 * cells at that count, as half-open index ranges. `most` is 0, with no runs,
 * on a day nobody else has any time on.
 */
export type Peak = { most: number; runs: { from: number; to: number }[] };

export function peakOf(counts: readonly number[]): Peak {
  const most = Math.max(0, ...counts);
  if (most === 0) return { most, runs: [] };
  const runs: { from: number; to: number }[] = [];
  counts.forEach((count, index) => {
    if (count !== most) return;
    const last = runs[runs.length - 1];
    if (last !== undefined && last.to === index) last.to = index + 1;
    else runs.push({ from: index, to: index + 1 });
  });
  return { most, runs };
}

/**
 * "Most others are free 2–4 pm and 6–8 pm" (SUS-206): the stretches of a day
 * where the count is at or near the day's highest, as half-open cell ranges in
 * time order, from the same per-half-hour counts the cells used to show. A cell
 * is in when its count is at least `SHARE` of the day's most and at least 1,
 * and adjacent ones run together; past `MOST_STRETCHES` the longest are kept.
 * Counts and times only, never who: aggregate in, aggregate out. Empty when
 * nobody else is free at any time that day.
 */
export const FREE_SHARE = 0.75;
export const MOST_STRETCHES = 3;

export function freeStretches(counts: readonly number[]): { from: number; to: number }[] {
  const most = Math.max(0, ...counts);
  if (most === 0) return [];
  const floor = Math.max(1, Math.ceil(most * FREE_SHARE));
  const runs: { from: number; to: number }[] = [];
  counts.forEach((count, index) => {
    if (count < floor) return;
    const last = runs[runs.length - 1];
    if (last !== undefined && last.to === index) last.to = index + 1;
    else runs.push({ from: index, to: index + 1 });
  });
  if (runs.length <= MOST_STRETCHES) return runs;
  // The longest, the earlier first on a tie, put back in time order.
  return [...runs]
    .sort((a, b) => b.to - b.from - (a.to - a.from) || a.from - b.from)
    .slice(0, MOST_STRETCHES)
    .sort((a, b) => a.from - b.from);
}
