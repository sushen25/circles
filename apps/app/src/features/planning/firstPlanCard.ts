import type { PlanCategory, WindowPreset } from '@circles/domain';

import { t } from '../../copy';
import { bandWords, type FirstPlanPreview } from './firstPlan';
import type { DateRange } from './form';
import { categoryLabel, closesAtWords, closesIn, datesWords } from './words';

/**
 * The words on FirstPlan's card, from a preview — one place, for the card made
 * in an existing circle (`FirstPlanFlow`) and the one drafted before there is a
 * circle (`FirstPlanDraftFlow`), so the two cannot say different things about
 * the same plan.
 */
const DURATION: Record<number, () => string> = {
  60: () => t('firstPlan', 'about_1_hour'),
  90: () => t('firstPlan', 'about_90_minutes'),
  120: () => t('firstPlan', 'about_2_hours'),
  180: () => t('firstPlan', 'about_3_hours'),
  240: () => t('firstPlan', 'about_4_hours'),
  300: () => t('firstPlan', 'about_5_hours'),
};

const WINDOW_TITLE: Partial<Record<WindowPreset, () => string>> = {
  next_14_days: () => t('firstPlan', 'catch_up_next_14_days'),
  this_weekend: () => t('firstPlan', 'catch_up_this_weekend'),
  tonight: () => t('firstPlan', 'catch_up_tonight'),
};

/**
 * "Catch up · next 14 days". The first-run card is always a catch-up in one of
 * three windows; a plan drafted with the full setup can be any kind in any
 * window, and says so in the same shape.
 */
function windowTitle(
  preset: WindowPreset,
  category: PlanCategory,
  custom: DateRange | undefined,
): string {
  const known = WINDOW_TITLE[preset];
  if (known !== undefined && category === 'catch_up') return known();
  const when =
    preset === 'custom'
      ? custom === undefined
        ? t('firstPlan', 'when_custom')
        : datesWords(custom)
      : t('firstPlan', `when_${preset}`);
  return t('firstPlan', 'window_title', { what: categoryLabel(category), when });
}

export type FirstPlanCardWords = {
  window: string;
  band: string;
  duration: string;
  closesIn: string;
  closesAt: string;
};

export function firstPlanCardWords(
  preview: Pick<FirstPlanPreview, 'band' | 'durationMinutes' | 'deadline' | 'latestStart'>,
  preset: WindowPreset,
  zone: string,
  openedAt: number,
  plan: { category?: PlanCategory | undefined; custom?: DateRange | undefined } = {},
): FirstPlanCardWords {
  const band = bandWords(preview.band);
  return {
    window: windowTitle(preset, plan.category ?? 'catch_up', plan.custom),
    band:
      preset === 'tonight'
        ? t('firstPlan', 'tonight_hours', { time: band })
        : preview.band.startMin >= 17 * 60
          ? t('firstPlan', 'evenings', { time: band })
          : t('firstPlan', 'days', { time: band }),
    duration: (DURATION[preview.durationMinutes] ?? DURATION[120]!)(),
    closesIn:
      preview.deadline === undefined
        ? t('firstPlan', 'replies_close_in_3_days')
        : closesIn(preview.deadline, openedAt),
    closesAt:
      preview.deadline === undefined || preview.latestStart === undefined
        ? ''
        : closesAtWords({ deadline: preview.deadline, latestStart: preview.latestStart }, zone),
  };
}
