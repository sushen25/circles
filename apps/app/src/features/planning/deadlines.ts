import {
  HALF_HOUR,
  addDays,
  addMinutes,
  fromISO,
  fromLocal,
  isDeadlineAllowed,
  localDate,
  toISO,
  toLocal,
  zone as toZone,
  type Instant,
} from '@circles/domain';

/**
 * When replies close — the sheet behind the setup's "Replies close" row
 * (spec §5.3: "editable, never after the last possible start").
 *
 * The rule is the domain's `isDeadlineAllowed`, called with `now` so a moment
 * already gone is refused too. **There is no minimum.** If the organiser wants
 * replies to close in ten minutes that is a choice the spec permits (S1-02's
 * second note), so the sheet offers anything from the next half hour to the
 * last possible start and nothing here narrows it.
 */
export type DeadlineChoice = 'hour' | 'day' | 'two_days' | 'three_days' | 'latest';

const HOURS: Record<Exclude<DeadlineChoice, 'latest'>, number> = {
  hour: 1,
  day: 24,
  two_days: 48,
  three_days: 72,
};

/** The quick choices that fit before the last possible start, each with its instant. */
export function deadlineChoices(
  now: Instant,
  latestStart: string,
): { choice: DeadlineChoice; at: string }[] {
  const latest = fromISO(latestStart);
  const quick = (Object.keys(HOURS) as (keyof typeof HOURS)[])
    .map((choice) => ({ choice, at: addMinutes(now, HOURS[choice] * 60) }))
    .filter(({ at }) => isDeadlineAllowed(at, latest, now))
    .map(({ choice, at }) => ({ choice: choice as DeadlineChoice, at: toISO(at) }));
  // The latest there is, always — the whole window's worth of replies.
  return isDeadlineAllowed(latest, latest, now)
    ? [...quick, { choice: 'latest', at: latestStart }]
    : quick;
}

/**
 * The days a chosen deadline can fall on: today to the day of the last
 * possible start, in the circle's zone.
 */
export function deadlineDays(now: Instant, latestStart: string, zone: string): string[] {
  const z = toZone(zone);
  const first = toLocal(now, z).date;
  const last = toLocal(fromISO(latestStart), z).date;
  const days: string[] = [];
  for (let date = first; date <= last; date = addDays(date, 1)) days.push(date);
  return days;
}

/** A local day and time as the instant it names, in the circle's zone. */
export function deadlineAt(day: string, minutesOfDay: number, zone: string): string {
  return toISO(fromLocal(localDate(day), minutesOfDay, toZone(zone)));
}

/** The day and half hour an instant falls on, for the sheet to start from. */
export function deadlineParts(iso: string, zone: string): { day: string; minutes: number } {
  const local = toLocal(fromISO(iso), toZone(zone));
  return {
    day: local.date,
    minutes: Math.floor(local.minutesOfDay / HALF_HOUR) * HALF_HOUR,
  };
}

/** Whether a day-and-time pick is a deadline the plan may have. */
export function allowedAt(iso: string, latestStart: string, now: Instant): boolean {
  return isDeadlineAllowed(fromISO(iso), fromISO(latestStart), now);
}

/** A half hour later or earlier on the same day, kept inside the day. */
export function stepMinutes(minutes: number, direction: 1 | -1): number {
  return Math.min(24 * 60 - HALF_HOUR, Math.max(0, minutes + direction * HALF_HOUR));
}
