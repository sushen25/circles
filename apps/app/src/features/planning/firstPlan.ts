import {
  DURATIONS,
  defaultDeadline,
  formatRange,
  lastPossibleStart,
  quorumDefault,
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
export type FirstPlanPreview = {
  durationMinutes: DurationMinutes;
  /** 17:30–22:30 for a fortnight, which is mostly weekdays (`dailyForRange`). */
  band: { startMin: number; endMin: number };
  quorum: number;
  members: number;
  /** ISO; undefined when the window leaves no room to reply (never, for a fortnight). */
  deadline: string | undefined;
};

export type PreviewInput = {
  zone: string;
  defaultDurationMinutes: number;
  defaultQuorum: number | null;
  members: number;
};

export function firstPlanPreview(input: PreviewInput, now: Instant): FirstPlanPreview {
  const zone = toZone(input.zone);
  const durationMinutes = (DURATIONS as readonly number[]).includes(input.defaultDurationMinutes)
    ? (input.defaultDurationMinutes as DurationMinutes)
    : 120;

  // `quorumFor`'s rule: the circle's own default, or `max(2, ceil(n × 0.6))`.
  const quorum = input.defaultQuorum ?? quorumDefault(input.members);

  const resolved = resolvePreset('next_14_days', now, zone, { durationMinutes });
  if (typeof resolved === 'string') {
    return {
      durationMinutes,
      band: { startMin: 0, endMin: 0 },
      quorum,
      members: input.members,
      deadline: undefined,
    };
  }
  const latest = lastPossibleStart({ ...resolved, durationMinutes, zone });
  const deadline = defaultDeadline('next_14_days', now, latest);

  return {
    durationMinutes,
    band: resolved.daily,
    quorum,
    members: input.members,
    deadline: deadline === undefined ? undefined : toISO(deadline),
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
