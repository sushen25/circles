import {
  DURATIONS,
  defaultDeadline,
  formatRange,
  lastPossibleStart,
  softQuorum,
  resolvePreset,
  toISO,
  zone as toZone,
  type DurationMinutes,
  type Instant,
  type TimeFormat,
} from '@circles/domain';

/**
 * What FirstPlan's card shows before anything is sent (spec §5.1 step 7): the
 * `next_14_days` preset resolved in the circle's zone, the circle's duration,
 * the quorum over the members there are now, and the default deadline — each
 * from the domain rule the server will apply, so the card and the plan agree.
 *
 * **A preview, and the quorum says so.** Nothing here is sent: `create-plan`
 * resolves the same defaults at the moment the plan is made, so somebody who
 * joins while the organiser is reading this card is counted (spec: "adjusts as
 * more people join").
 */
/**
 * The presets the first-run card offers (S2-06): the fortnight it has always
 * defaulted to, and the two spontaneous ones. Next 7 days and Custom are the
 * full setup's — the card is one tap with defaults, not a second form.
 */
export const FIRST_PLAN_PRESETS = ['next_14_days', 'this_weekend', 'tonight'] as const;
export type FirstPlanPreset = (typeof FIRST_PLAN_PRESETS)[number];

export type FirstPlanPreview = {
  preset: FirstPlanPreset;
  /** False when this preset cannot be made right now — tonight, late in the evening. */
  available: boolean;
  durationMinutes: DurationMinutes;
  /** 17:30–22:30 for a fortnight, which is mostly weekdays (`dailyForRange`). */
  band: { startMin: number; endMin: number };
  quorum: number;
  members: number;
  /** ISO; undefined when the window leaves no room to reply (never, for a fortnight). */
  deadline: string | undefined;
  /** ISO: the latest the meetup could begin, for the deadline's own words. */
  latestStart: string | undefined;
};

export type PreviewInput = {
  zone: string;
  defaultDurationMinutes: number;
  defaultQuorum: number | null;
  members: number;
};

export function firstPlanPreview(
  input: PreviewInput,
  now: Instant,
  preset: FirstPlanPreset = 'next_14_days',
): FirstPlanPreview {
  const zone = toZone(input.zone);
  const durationMinutes = (DURATIONS as readonly number[]).includes(input.defaultDurationMinutes)
    ? (input.defaultDurationMinutes as DurationMinutes)
    : 120;

  // What `create-plan` will resolve: the circle's own default, or — when
  // nobody has chosen — the placeholder that follows the circle as people join
  // (`softQuorum`, ADR 0026). The card says "adjusts as more people join"
  // underneath, and since this ticket that is true.
  const quorum = input.defaultQuorum ?? softQuorum(input.members);

  const resolved = resolvePreset(preset, now, zone, { durationMinutes });
  if (typeof resolved === 'string') {
    return {
      preset,
      available: false,
      durationMinutes,
      band: { startMin: 0, endMin: 0 },
      quorum,
      members: input.members,
      deadline: undefined,
      latestStart: undefined,
    };
  }
  const latest = lastPossibleStart({ ...resolved, durationMinutes, zone });
  const deadline = defaultDeadline(preset, now, latest);

  return {
    preset,
    available: deadline !== undefined,
    durationMinutes,
    band: resolved.daily,
    quorum,
    members: input.members,
    deadline: deadline === undefined ? undefined : toISO(deadline),
    latestStart: toISO(latest),
  };
}

/** This device's clock, for the band's times (manifesto §6). */
export function deviceTimeFormat(): TimeFormat {
  try {
    const hour12 = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12;
    return { hour12: hour12 ?? true };
  } catch {
    return { hour12: true };
  }
}

export function bandWords(band: { startMin: number; endMin: number }): string {
  return formatRange(band.startMin, band.endMin, deviceTimeFormat());
}
