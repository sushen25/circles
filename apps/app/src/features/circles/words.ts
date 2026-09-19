import { cadenceState, fromISO, zone as toZone, type Cadence, type Circle } from '@circles/domain';

import { t } from '../../copy';
import type { CircleHome, HomeMember } from '../../data/circles';
import { dayWords } from '../planning/when';

/**
 * The circle home's sentences, from the copy file and the data (spec §5.2).
 * Cadence copy is the spec's own — "No rush", "Due soon", "No goal set" —
 * and never a count of days or a score.
 */
const CADENCE: Record<Cadence, () => string> = {
  weekly: () => t('circleHome', 'about_weekly'),
  fortnightly: () => t('circleHome', 'about_fortnightly'),
  monthly: () => t('circleHome', 'about_monthly'),
  two_monthly: () => t('circleHome', 'about_every_two_months'),
  none: () => t('circleHome', 'no_goal_set'),
};

export function cadenceWords(cadence: Cadence): string {
  return CADENCE[cadence]();
}

/** "3 in so far · about monthly" — while the circle is filling. */
export function joiningSubtitle(home: CircleHome): string {
  return t('circleHomeJoining', 'in_so_far', {
    count: home.members.length,
    what: cadenceWords(home.cadence),
  });
}

/** "6 members · about monthly". */
export function homeSubtitle(home: CircleHome): string {
  return home.members.length === 1
    ? t('circleHome', 'one_member', { what: cadenceWords(home.cadence) })
    : t('circleHome', 'members', { count: home.members.length, what: cadenceWords(home.cadence) });
}

/** How recent counts as "just": a day. Anybody earlier is simply in the circle. */
const JUST_MS = 24 * 60 * 60 * 1000;

/**
 * "Priya and Tom just joined" — the people who arrived in the last day, newest
 * first, never the reader. Undefined when nobody has.
 */
export function justJoined(
  members: readonly HomeMember[],
  me: string | undefined,
  now = Date.now(),
): string | undefined {
  const recent = members
    .filter((m) => m.userId !== me && now - Date.parse(m.joinedAt) < JUST_MS)
    .sort((a, b) => Date.parse(b.joinedAt) - Date.parse(a.joinedAt));
  const [first, second] = recent;
  if (first === undefined) return undefined;
  if (second === undefined) return t('circleHomeJoining', 'one_just_joined', { name: first.name });
  if (recent.length === 2) {
    return t('circleHomeJoining', 'two_just_joined', { name: first.name, other: second.name });
  }
  return t('circleHomeJoining', 'many_just_joined', {
    name: first.name,
    count: recent.length - 1,
  });
}

/** "Sat 8 Aug", or "Not yet" for a circle that has never met. */
export function lastCaughtUp(home: CircleHome): string {
  return home.lastMetAt === null ? t('circleHome', 'not_yet') : dayWords(home.lastMetAt, home.zone);
}

/** The "Next one" cell: the domain's cadence state in the spec's words. */
export function nextOne(home: CircleHome, now = new Date()): string {
  const circle: Circle = {
    id: home.id as Circle['id'],
    ownerUserId: '' as Circle['ownerUserId'],
    name: home.name,
    color: '',
    zone: toZone(home.zone),
    cadence: home.cadence,
    defaultDurationMinutes: home.defaultDurationMinutes,
    status: 'active',
    ...(home.lastMetAt === null ? {} : { lastMetAt: fromISO(home.lastMetAt) }),
    ...(home.cadenceSnoozedUntil === null
      ? {}
      : { cadenceSnoozedUntil: fromISO(home.cadenceSnoozedUntil) }),
  };
  switch (cadenceState(circle, fromISO(now.toISOString()))) {
    case 'no_goal':
      return t('circleHome', 'no_goal_set');
    case 'never_met':
      return t('circleHome', 'up_to_you');
    case 'due_soon':
      return t('circleHome', 'due_soon');
    case 'no_rush':
    case 'active_plan':
      return t('circleHome', 'no_rush');
  }
}
