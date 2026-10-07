import { t } from '../../copy';

/**
 * How a number is said on the founder's screen. Pure, and in words from the
 * copy file: the months, the units and the percent sign are not this file's.
 */
const MONTHS = [
  'month_01',
  'month_02',
  'month_03',
  'month_04',
  'month_05',
  'month_06',
  'month_07',
  'month_08',
  'month_09',
  'month_10',
  'month_11',
  'month_12',
] as const;

function monthName(month: number): string {
  return t('founderAnalytics', MONTHS[month - 1] ?? 'month_01');
}

/** `75%`: a share, rounded to a whole number. */
export function percent(share: number): string {
  return t('founderAnalytics', 'percent', { count: Math.round(share * 100) });
}

/** `1 m 40 s`, `45 s`: a wait in seconds. */
export function waitOf(seconds: number): string {
  const whole = Math.round(seconds);
  if (whole < 60) return t('founderAnalytics', 'seconds_only', { count: whole });
  return t('founderAnalytics', 'minutes_seconds', {
    count: Math.floor(whole / 60),
    total: whole % 60,
  });
}

/** `7 Sep` from `2026-09-07`. */
export function dayOf(iso: string): string {
  const [, month, day] = iso.slice(0, 10).split('-');
  return t('founderAnalytics', 'day_month', {
    day: Number(day),
    month: monthName(Number(month)),
  });
}

/** `Oct 2026` from `2026-10-01T00:00:00`. */
export function monthOf(iso: string): string {
  const [year, month] = iso.slice(0, 7).split('-');
  return t('founderAnalytics', 'month_year', { month: monthName(Number(month)), date: year ?? '' });
}

/** Meetups per activated circle, to one place; `undefined` with no circle to divide by. */
export function perCircle(reported: number, circles: number): string | undefined {
  return circles === 0 ? undefined : (reported / circles).toFixed(1);
}
