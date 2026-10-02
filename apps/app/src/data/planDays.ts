/**
 * The days a plan asks about, from the rows PostgREST embeds as
 * `plan_days(day)` (ADR 0047). No rows is every day from the window's first to
 * its last, which is every preset and every plan made before a plan could
 * have gaps, and comes back as `undefined` so the window reads as it always
 * did. Sorted here, because an embedded list has no order of its own.
 */
export function daysOf(rows: readonly { day: string }[] | null | undefined): string[] | undefined {
  if (rows === null || rows === undefined || rows.length === 0) return undefined;
  return rows.map((row) => row.day).sort();
}
