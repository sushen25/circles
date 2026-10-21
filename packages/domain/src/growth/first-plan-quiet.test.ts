import { describe, expect, it } from 'vitest';

import { fromISO } from '../shared/instant.js';
import {
  FIRST_PLAN_QUIET_HOURS,
  firstPlanQuiet,
  firstPlanQuietLetterDue,
} from './first-plan-quiet.js';

const CREATED = fromISO('2026-10-12T09:00:00Z');
const hoursAfter = (h: number) => fromISO(new Date(CREATED + h * 3_600_000).toISOString());

const quiet = {
  createdAt: CREATED,
  now: hoursAfter(48),
  othersAnswered: 0,
  isFirstPlan: true,
  stillAsking: true,
};

describe('firstPlanQuiet', () => {
  it('is 48 hours', () => {
    expect(FIRST_PLAN_QUIET_HOURS).toBe(48);
  });

  it('holds from exactly 48 hours, and not a minute before', () => {
    expect(firstPlanQuiet(quiet)).toBe(true);
    expect(firstPlanQuiet({ ...quiet, now: hoursAfter(48 - 1 / 60) })).toBe(false);
    expect(firstPlanQuiet({ ...quiet, now: hoursAfter(30) })).toBe(false);
    expect(firstPlanQuiet({ ...quiet, now: hoursAfter(200) })).toBe(true);
  });

  it('does not hold once anyone else has answered', () => {
    expect(firstPlanQuiet({ ...quiet, othersAnswered: 1 })).toBe(false);
  });

  it('is for the first plan only', () => {
    expect(firstPlanQuiet({ ...quiet, isFirstPlan: false })).toBe(false);
  });

  it('is for a plan still asking only', () => {
    expect(firstPlanQuiet({ ...quiet, stillAsking: false })).toBe(false);
  });
});

describe('firstPlanQuietLetterDue', () => {
  it('is owed once the plan has gone quiet and nothing was sent to this circle', () => {
    expect(firstPlanQuietLetterDue({ ...quiet, alreadySent: false })).toBe(true);
  });

  it('is never owed twice to a circle, however quiet its plans', () => {
    expect(firstPlanQuietLetterDue({ ...quiet, alreadySent: true })).toBe(false);
    expect(firstPlanQuietLetterDue({ ...quiet, alreadySent: true, now: hoursAfter(500) })).toBe(
      false,
    );
  });

  it('is not owed before 48 hours', () => {
    expect(firstPlanQuietLetterDue({ ...quiet, now: hoursAfter(47), alreadySent: false })).toBe(
      false,
    );
  });
});
