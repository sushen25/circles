/**
 * When a quiet ask stops asking (spec §5.4, ADR 00XX).
 *
 * The setup screen offers a few named stop times rather than a clock, because
 * "Friday midday" is a decision and "Fri 11 Sep 12:00" is a form field. Each
 * option resolves to an instant in the plan's zone, and only the options that
 * resolve to a *valid* stop time are offered.
 *
 * **Valid means strictly after now and strictly before the last possible
 * start.** Spec §5.4 says the stop time "is always before the window it asks
 * about", and read literally that cannot be met by the spec's own options: a
 * tonight ask's window opens at the next half hour, so "tonight, 9 pm" is
 * inside it, and a next-7-days window opens today, so no later stop time is
 * before it. What the sentence protects is that an ask never runs past the
 * point where the meetup could still happen — an ask that opens once nobody
 * can meet is an ask about nothing. The last possible start is that point, and
 * it is the same bound the response deadline already lives under (§5.3).
 *
 * No margin before it, for the reason ADR 0010 gave the deadline: a minimum
 * would be a product rule this module has no business inventing. The deadline
 * the plan gets when it opens is `defaultDeadline` at that moment, which
 * already bends to whatever time is left.
 */

import { type Instant, addMinutes, isAfter, isBefore } from '../shared/instant.js';
import { addDays, weekday } from '../shared/local-date.js';
import { fromLocal, toLocal } from '../shared/zone.js';
import { lastPossibleStart } from './deadline.js';
import type { PlanTiming, WindowPreset } from './types.js';

/** A quiet ask picks from four windows; a custom one is a named plan's (spec §5.4). */
export type QuietPreset = Exclude<WindowPreset, 'custom'>;

export const QUIET_PRESETS: readonly QuietPreset[] = [
  'tonight',
  'this_weekend',
  'next_7_days',
  'next_14_days',
];

export function isQuietPreset(preset: WindowPreset): preset is QuietPreset {
  return (QUIET_PRESETS as readonly WindowPreset[]).includes(preset);
}

export type StopTimeOption = 'tonight_9pm' | 'friday_midday' | 'two_days' | 'when_window_starts';

/** In the order the chips appear. */
export const STOP_TIME_OPTIONS: readonly StopTimeOption[] = [
  'tonight_9pm',
  'friday_midday',
  'two_days',
  'when_window_starts',
];

/**
 * Which options belong to which window, before validity is asked.
 *
 * "Tonight, 9 pm" is offered for every window, as the SparkSetup artboard
 * does — asking on a Tuesday about the weekend and stopping tonight is a
 * reasonable thing to want. "Friday midday" is only a weekend's (§5.4 names it
 * "for a weekend ask"), and "in two days" only a week's or a fortnight's, where
 * the window itself is too long to wait for.
 */
const APPLIES: Record<StopTimeOption, readonly QuietPreset[]> = {
  tonight_9pm: QUIET_PRESETS,
  friday_midday: ['this_weekend'],
  two_days: ['next_7_days', 'next_14_days'],
  when_window_starts: QUIET_PRESETS,
};

/** The option picked when the person picks none — the artboard's starred chip. */
const PREFERRED: Record<QuietPreset, StopTimeOption> = {
  tonight: 'tonight_9pm',
  this_weekend: 'friday_midday',
  next_7_days: 'two_days',
  next_14_days: 'two_days',
};

const NINE_PM = 21 * 60;
const MIDDAY = 12 * 60;
const FRIDAY = 5;
const SATURDAY = 6;
const TWO_DAYS_MINUTES = 48 * 60;

/**
 * The instant an option names, or `undefined` when it names nothing for this
 * window — "Friday midday" for a weekend that starts on a Sunday has no Friday
 * in front of it. Not a validity check; `isValidStopTime` is.
 */
export function stopTimeAt(
  option: StopTimeOption,
  now: Instant,
  timing: PlanTiming,
): Instant | undefined {
  switch (option) {
    case 'tonight_9pm':
      return fromLocal(toLocal(now, timing.zone).date, NINE_PM, timing.zone);
    case 'friday_midday': {
      // The Friday immediately before a weekend that starts on its Saturday.
      // On a Saturday the weekend preset starts today, and "Friday" is gone.
      if (weekday(timing.window.start) !== SATURDAY) return undefined;
      const friday = addDays(timing.window.start, -1);
      return weekday(friday) === FRIDAY ? fromLocal(friday, MIDDAY, timing.zone) : undefined;
    }
    case 'two_days':
      // Elapsed time, not wall time: across a clock change "in two days" is
      // still forty-eight hours of asking, and nobody reads the hour it lands on.
      return addMinutes(now, TWO_DAYS_MINUTES);
    case 'when_window_starts':
      return fromLocal(timing.window.start, timing.daily.startMin, timing.zone);
  }
}

/** Strictly after now, strictly before the last possible start. The whole rule. */
export function isValidStopTime(stopAt: Instant, now: Instant, timing: PlanTiming): boolean {
  return isAfter(stopAt, now) && isBefore(stopAt, lastPossibleStart(timing));
}

export type StopTimeChoice = {
  readonly option: StopTimeOption;
  readonly at: Instant;
};

export type StopTimeOptions = {
  /** Only the valid ones, in chip order. Empty means the ask cannot be made. */
  readonly options: readonly StopTimeChoice[];
  /** The preset's usual choice when it is valid, else the first valid one. */
  readonly preferred: StopTimeChoice | undefined;
};

/**
 * What the setup screen offers for this window, and which chip starts selected.
 *
 * The ticket named `(preset, now, zone)`; the zone alone cannot answer, because
 * validity turns on the last possible start, which needs the band and the
 * duration too. A `PlanTiming` carries all four.
 */
export function stopTimeOptions(
  preset: QuietPreset,
  now: Instant,
  timing: PlanTiming,
): StopTimeOptions {
  const options: StopTimeChoice[] = [];
  for (const option of STOP_TIME_OPTIONS) {
    if (!APPLIES[option].includes(preset)) continue;
    const at = stopTimeAt(option, now, timing);
    if (at !== undefined && isValidStopTime(at, now, timing)) options.push({ option, at });
  }
  const preferred = options.find((c) => c.option === PREFERRED[preset]) ?? options[0];
  return { options, preferred };
}

/**
 * Resolve the option somebody submitted, refusing one this window does not
 * offer. The server calls this rather than trusting an instant from the client,
 * so the stop time is always one of the offered ones and always valid.
 */
export function resolveStopTime(
  preset: QuietPreset,
  option: StopTimeOption,
  now: Instant,
  timing: PlanTiming,
): Instant | undefined {
  return stopTimeOptions(preset, now, timing).options.find((c) => c.option === option)?.at;
}
