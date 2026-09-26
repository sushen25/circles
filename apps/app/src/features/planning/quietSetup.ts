import {
  canCreateQuietAsk,
  DURATIONS,
  instant,
  localDate,
  planAnotherDefaults,
  stopTimeOptions,
  zone as toZone,
  type DurationMinutes,
  type PlanCategory,
  type QuietRefusal,
  type QuietPreset,
  type StopTimeOption,
} from '@circles/domain';

import { t } from '../../copy';
import type { CircleHome } from '../../data/circles';
import type { LastHappenedPlan } from '../../data/planning';
import { windowOf, type Band } from './form';

/**
 * SparkSetup's form, as data (spec §5.4.1): the window, what for, and when to
 * stop asking. Every rule is the domain's — the window is `resolvePreset`'s,
 * the stop times `stopTimeOptions`' — which is what `create-plan` applies, so
 * a chip on screen is a chip the server will take.
 */
export type QuietDraft = {
  preset: QuietPreset;
  category: PlanCategory;
  /** Chosen hours, carried from last time; undefined is the window's own. */
  band: Band | undefined;
  duration: DurationMinutes;
  /** The stop time picked; undefined is the window's preferred one. */
  stop: StopTimeOption | undefined;
};

export function draftFrom(last: LastHappenedPlan | null, circleDuration: number): QuietDraft {
  const duration = (DURATIONS as readonly number[]).includes(circleDuration)
    ? (circleDuration as DurationMinutes)
    : 120;
  if (last === null) {
    return {
      preset: 'this_weekend',
      category: 'catch_up',
      band: undefined,
      duration,
      stop: undefined,
    };
  }
  const defaults = planAnotherDefaults(last);
  return {
    preset: defaults.preset,
    category: defaults.category,
    band: defaults.daily,
    duration: defaults.durationMinutes,
    stop: undefined,
  };
}

/** What the draft means at `now`: the window, and the stop times it offers. */
export function resolveQuiet(draft: QuietDraft, now: number, zone: string) {
  const at = instant(now);
  const shape = windowOf(draft.preset, undefined, draft.band, draft.duration, at, zone);
  if (typeof shape === 'string') return { ok: false as const, problem: shape };
  const offered = stopTimeOptions(draft.preset, at, {
    window: { start: localDate(shape.window.start), end: localDate(shape.window.end) },
    daily: shape.band,
    durationMinutes: draft.duration,
    zone: toZone(zone),
  });
  const chosen =
    offered.options.find((choice) => choice.option === draft.stop) ?? offered.preferred;
  return { ok: true as const, options: offered.options, chosen };
}

export function stopLabel(option: StopTimeOption, preset: QuietPreset): string {
  switch (option) {
    case 'tonight_9pm':
      return t('sparkSetup', 'tonight_9_pm');
    case 'friday_midday':
      return t('sparkSetup', 'friday_midday');
    case 'two_days':
      return t('sparkSetup', 'in_two_days');
    case 'when_window_starts':
      return preset === 'this_weekend'
        ? t('sparkSetup', 'when_the_weekend_starts')
        : t('sparkSetup', 'when_it_starts');
  }
}

/**
 * Whether this reader may start a quiet ask here, as far as their own circle
 * read can say — the domain's `canCreateQuietAsk`, in the domain's order, not
 * a second copy of it (non-negotiable 2).
 *
 * Two of its questions are answered elsewhere. A saved place is the organiser
 * gate's, drawn in place of the form (ADR 0004). The per-member and per-circle
 * limits turn on other members' asks, which a member may not read — and must
 * not, since whose ask is whose is the point — so `recentAsks` is empty here
 * and `create-plan` says `already_asking` or `circle_ask_limit` if it comes to
 * that.
 */
export function quietStanding(
  home: Pick<CircleHome, 'status' | 'members' | 'mine' | 'activePlan'>,
  now: number,
): 'allowed' | QuietRefusal {
  return canCreateQuietAsk({
    member: {
      isPermanent: true,
      isMember: true,
      mutedQuietAsks: home.mine?.mutedQuietAsks === true,
    },
    circle: { status: home.status, activeMembers: home.members.length },
    circleHasOpenPlan: home.activePlan !== null,
    recentAsks: [],
    now: instant(now),
  });
}
