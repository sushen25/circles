import { type DurationMinutes, type Plan, instant, localDate, zone } from '@circles/domain';

/**
 * A `plans` row as the domain's `Plan`, for `quietView`. The same mapping the
 * dispatcher's `context.ts` makes for its own reads; kept here rather than
 * shared because this one reads the row through the caller and nothing else
 * of the dispatcher's.
 */
export function quietPlanOf(row: Record<string, unknown>): Plan {
  const at = (value: unknown) => instant(Date.parse(value as string));
  const organiser = row['organiser_user_id'] as string | null;
  const threshold = row['quiet_threshold'] as number | null;
  const expires = row['quiet_expires_at'] as string | null;
  return {
    id: row['id'] as Plan['id'],
    circleId: row['circle_id'] as Plan['circleId'],
    mode: row['mode'] as Plan['mode'],
    state: row['state'] as Plan['state'],
    ...(organiser === null
      ? {}
      : { organiserUserId: organiser as NonNullable<Plan['organiserUserId']> }),
    title: row['title'] as string,
    category: row['category'] as Plan['category'],
    zone: zone(row['time_zone'] as string),
    window: {
      start: localDate(row['window_start'] as string),
      end: localDate(row['window_end'] as string),
    },
    daily: {
      startMin: row['daily_start_local'] as number,
      endMin: row['daily_end_local'] as number,
    },
    durationMinutes: row['duration_minutes'] as DurationMinutes,
    quorum: row['quorum'] as number,
    requiredMemberIds: [],
    responseDeadline: at(row['response_deadline']),
    ...(threshold === null ? {} : { quietThreshold: threshold }),
    ...(expires === null ? {} : { quietExpiresAt: at(expires) }),
    revision: row['revision'] as number,
    inputVersion: row['input_version'] as number,
    scoringVersion: row['scoring_version'] as number,
    shortCode: row['short_code'] as string,
  };
}
