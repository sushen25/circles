import {
  defaultDeadline,
  fromISO,
  isDeadlineAllowed,
  lastStartOf,
  localDate,
  resolvePreset,
  softQuorum,
  toISO,
  zone as toZone,
  type DurationMinutes,
  type Instant,
  type PlanCategory,
  type PresetError,
  type WindowPreset,
} from '@circles/domain';

/**
 * The plan setup form, as data (spec §5.3).
 *
 * The screen holds a `PlanDraft` and asks `resolveDraft` what it means: the
 * window, the band, the last possible start and the deadline — every one from
 * the domain rule `create-plan` applies, so what the card says is what the
 * server will make. Nothing is decided here that the domain does not already
 * decide (non-negotiable 2); this is the wiring between its answers.
 *
 * **Undefined means "the default", and the default is not sent.** A quorum the
 * organiser never touched is left to the server, where it stays *defaulted*
 * and follows the plan's audience as people join (ADR 0026); a deadline never
 * touched is the preset's own. Sending what the screen merely displayed would
 * turn a default into a choice nobody made.
 */
export type Band = { startMin: number; endMin: number };
export type DateRange = { start: string; end: string };

export const PRESETS: readonly WindowPreset[] = [
  'tonight',
  'this_weekend',
  'next_7_days',
  'next_14_days',
  'custom',
];

export const CATEGORIES: readonly PlanCategory[] = [
  'catch_up',
  'dinner',
  'drinks',
  'coffee',
  'activity',
];

export type PlanDraft = {
  category: PlanCategory;
  preset: WindowPreset;
  /** The dates picked on CustomWindow; only read when `preset` is `custom`. */
  custom: DateRange | undefined;
  /** An explicit daily band, or undefined for the window's own suggestion. */
  band: Band | undefined;
  duration: DurationMinutes;
  /** Undefined: nobody chose (ADR 0026). */
  quorum: number | undefined;
  /** Undefined: the organiser alone, which is the server's default too. */
  required: string[] | undefined;
  /** ISO. Undefined: the preset's default deadline. */
  deadline: string | undefined;
};

export type ResolveProblem = PresetError | 'deadline_out_of_range';

export type Resolved =
  | {
      ok: true;
      window: DateRange;
      band: Band;
      /** ISO: the latest the meetup could begin. The deadline may not pass it. */
      latestStart: string;
      /** ISO: the explicit deadline if there is one, else the preset's default. */
      deadline: string;
      deadlineIsDefault: boolean;
    }
  | { ok: false; problem: ResolveProblem };

export function defaultDraft(input: {
  duration: DurationMinutes;
  preset?: WindowPreset | undefined;
}): PlanDraft {
  return {
    category: 'catch_up',
    preset: input.preset ?? 'next_14_days',
    custom: undefined,
    band: undefined,
    duration: input.duration,
    quorum: undefined,
    required: undefined,
    deadline: undefined,
  };
}

/** The window and band a preset means, now, for this duration and band. */
export function windowOf(
  preset: WindowPreset,
  custom: DateRange | undefined,
  band: Band | undefined,
  duration: DurationMinutes,
  now: Instant,
  zone: string,
): { window: DateRange; band: Band } | PresetError {
  const resolved = resolvePreset(preset, now, toZone(zone), {
    durationMinutes: duration,
    custom:
      custom === undefined
        ? undefined
        : { start: localDate(custom.start), end: localDate(custom.end) },
    daily: band,
  });
  if (typeof resolved === 'string') return resolved;
  return {
    window: { start: resolved.window.start, end: resolved.window.end },
    band: { startMin: resolved.daily.startMin, endMin: resolved.daily.endMin },
  };
}

/** The latest the meetup could begin, as ISO. */
export function latestStartOf(
  window: DateRange,
  band: Band,
  duration: DurationMinutes,
  zone: string,
): string {
  return toISO(
    lastStartOf(
      { start: localDate(window.start), end: localDate(window.end) },
      band,
      duration,
      toZone(zone),
    ),
  );
}

/**
 * The deadline to use: the one chosen, when it is still allowed, else the
 * preset's default for a plan made `now`. A chosen deadline that has stopped
 * being allowed is reported, not quietly replaced — the organiser picked it.
 */
export function deadlineFor(
  preset: WindowPreset,
  chosen: string | undefined,
  latestStart: string,
  now: Instant,
): { deadline: string; isDefault: boolean } | ResolveProblem {
  const latest = fromISO(latestStart);
  if (chosen !== undefined) {
    return isDeadlineAllowed(fromISO(chosen), latest, now)
      ? { deadline: chosen, isDefault: false }
      : 'deadline_out_of_range';
  }
  const suggested = defaultDeadline(preset, now, latest);
  return suggested === undefined
    ? 'window_has_passed'
    : { deadline: toISO(suggested), isDefault: true };
}

export function resolveDraft(draft: PlanDraft, now: Instant, zone: string): Resolved {
  const shape = windowOf(draft.preset, draft.custom, draft.band, draft.duration, now, zone);
  if (typeof shape === 'string') return { ok: false, problem: shape };
  const latestStart = latestStartOf(shape.window, shape.band, draft.duration, zone);
  const deadline = deadlineFor(draft.preset, draft.deadline, latestStart, now);
  if (typeof deadline === 'string') return { ok: false, problem: deadline };
  return {
    ok: true,
    window: shape.window,
    band: shape.band,
    latestStart,
    deadline: deadline.deadline,
    deadlineIsDefault: deadline.isDefault,
  };
}

/**
 * Which presets can be offered right now. Tonight is the one that can fail on
 * the clock, and it fails on the duration too: at 22:50 a one-hour catch-up
 * still fits and a two-hour one does not (S1-02's note). Hidden rather than
 * swapped for tomorrow — "tonight" meaning tomorrow is a lie.
 */
export function presetAvailable(
  preset: WindowPreset,
  band: Band | undefined,
  duration: DurationMinutes,
  now: Instant,
  zone: string,
): boolean {
  if (preset === 'custom') return true;
  return typeof windowOf(preset, undefined, band, duration, now, zone) !== 'string';
}

/**
 * Why Tonight is not on offer, or `undefined` when it is (S2-06).
 *
 * Since ADR 0010 tonight is refused for one reason only — no start left in the
 * band for a meetup this long — so the chip is never off without the screen
 * saying what would bring it back: a shorter catch-up, when an hour would
 * still fit, or another day, when nothing would. It points at This weekend
 * only while that is on offer: late on a Sunday the weekend has gone too
 * (review round 2).
 */
export type TonightNote = {
  fix: 'shorter' | 'another_day';
  weekend: boolean;
};

export function tonightNote(
  band: Band | undefined,
  duration: DurationMinutes,
  now: Instant,
  zone: string,
): TonightNote | undefined {
  if (presetAvailable('tonight', band, duration, now, zone)) return undefined;
  return {
    fix: presetAvailable('tonight', band, 60, now, zone) ? 'shorter' : 'another_day',
    weekend: presetAvailable('this_weekend', undefined, duration, now, zone),
  };
}

/**
 * The stepper's range: at least two, because a meetup of one is not a meetup
 * (`Quorum`), and at most the people there are — but never below two, so a
 * circle of one can still say "two of us".
 */
export function quorumRange(members: number): { min: number; max: number } {
  return { min: 2, max: Math.max(2, members) };
}

/** The number the setup shows before anybody touches it: what the server will resolve. */
export function shownQuorum(
  draft: PlanDraft,
  circle: { defaultQuorum: number | null; members: number },
): number {
  return draft.quorum ?? circle.defaultQuorum ?? softQuorum(circle.members);
}

/** `plan_created.window` for a preset (S1-22's mapping). */
export const WINDOW_EVENT = {
  tonight: 'tonight',
  this_weekend: 'weekend',
  next_7_days: 'next_week',
  next_14_days: 'next_two_weeks',
  custom: 'custom',
} as const satisfies Record<WindowPreset, string>;
