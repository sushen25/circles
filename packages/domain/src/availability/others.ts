/**
 * What the others have said, for the person answering (SUS-129, ADR 00XX).
 *
 * The editor shows, as counts, what the people who have already answered said,
 * so a guest can favour the days and hours that meet the most people. Counts
 * only, at every level: a day, a block of hours on a day, a line of the
 * reader's own answer, and each half hour. Nobody is named.
 *
 * Three rules, settled by the founder on 1 October 2026, live here and in
 * `public.others_availability`:
 *
 * - **The threshold is one.** Counts show once at least one other person has
 *   answered with times. With exactly one, the counts are that person's
 *   answer; that was accepted. "I'm easy" answers alone do not meet it: they
 *   would put the same number on every day, which says nothing about which day.
 * - **"I'm easy" counts everywhere** (spec §5.6): a flexible answer adds one to
 *   every day, block, overlap and half hour.
 * - **Free means any half hour.** Somebody counts for a block when they have any
 *   half hour inside it, and for a line of the answer when they share any half
 *   hour with it. The plan's duration does not come into it.
 *
 * Pure: the database gives the numbers and each other person's windows on each
 * day, with nothing to say whose they are or to link one day's to another's;
 * this works out every count from them.
 */

import { type Interval, overlaps } from '../shared/interval.js';

/** Counts show once this many others have answered with times. */
export const OTHERS_THRESHOLD = 1;

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
   * One entry per other person per day they gave times on: that person's
   * windows on that day. In no particular order, and nothing links an entry to
   * a person or to the same person's entry on another day. Empty below the
   * threshold, and never holds the reader's own answer.
   */
  readonly days: readonly (readonly Interval[])[];
};

/** Whether there is anything to count: the threshold, as the database applies it. */
export function othersShown(others: OthersSaid): boolean {
  return others.withTimes >= OTHERS_THRESHOLD && others.days.length > 0;
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
