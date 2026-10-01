/**
 * A plan's days with gaps, in words (ADR 00ZZ): its runs listed, "Thu 17 – Sat
 * 19 Sep, Tue 22 Sep and Thu 24 Sep", or past three runs a count. The dates
 * come in already written; `format.ts`'s `daysSpan` writes them.
 */
export const EN_DAYS = {
  list: (runs: readonly string[]): string =>
    runs.length <= 1
      ? (runs[0] ?? '')
      : `${runs.slice(0, -1).join(', ')} and ${runs[runs.length - 1] ?? ''}`,
  between: (p: { count: number; from: string; to: string }): string =>
    `${p.count} days between ${p.from} and ${p.to}`,
} as const;
