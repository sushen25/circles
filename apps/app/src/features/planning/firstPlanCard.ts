import { t } from '../../copy';
import { bandWords, type FirstPlanPreset, type FirstPlanPreview } from './firstPlan';
import { closesAtWords, closesIn } from './words';

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

const WINDOW_TITLE: Record<FirstPlanPreset, () => string> = {
  next_14_days: () => t('firstPlan', 'catch_up_next_14_days'),
  this_weekend: () => t('firstPlan', 'catch_up_this_weekend'),
  tonight: () => t('firstPlan', 'catch_up_tonight'),
};

export type FirstPlanCardWords = {
  window: string;
  band: string;
  duration: string;
  closesIn: string;
  closesAt: string;
};

export function firstPlanCardWords(
  preview: FirstPlanPreview,
  preset: FirstPlanPreset,
  zone: string,
  openedAt: number,
): FirstPlanCardWords {
  const band = bandWords(preview.band);
  return {
    window: WINDOW_TITLE[preset](),
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
