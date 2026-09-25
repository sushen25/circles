import { circleHomeState, fromISO, type CircleHomeState } from '@circles/domain';

import { t } from '../../copy';
import type { CircleHome, CircleSummary } from '../../data/circles';
import { dayWords } from '../planning/when';
import { dateOf, timeOf } from '../scheduling/words';
import { domainCircle } from './words';

/**
 * Which state a circle is in, and the sentences for it on the circles list and
 * the locked-in home (spec §5.2). The *choice* of state is the domain's
 * (`circleHomeState`); this only puts it in words. Never "overdue", a streak or
 * a count of days (spec §5.9).
 */

export function homeState(home: CircleHome, now = new Date()): CircleHomeState {
  return circleHomeState({
    circle: domainCircle(home),
    now: fromISO(now.toISOString()),
    findingATime: home.activePlan !== null,
    lockedIn: home.lockedIn !== null,
    activeMembers: home.members.length,
  });
}

export function summaryState(summary: CircleSummary, now = new Date()): CircleHomeState {
  return circleHomeState({
    circle: domainCircle(summary),
    now: fromISO(now.toISOString()),
    findingATime: summary.activePlan !== null,
    lockedIn: summary.lockedIn !== null,
    activeMembers: summary.memberCount,
  });
}

/**
 * The line under a circle's name on the list: "Finding a time · 5 of 6
 * replied", "Locked in · Thu 24 Sep", "Last caught up 2 Aug · No rush".
 */
export function listLine(summary: CircleSummary, now = new Date()): string {
  if (summary.status === 'archived') return t('circlesList', 'archived');
  const lastMet = (next: string) =>
    summary.lastMetAt === null
      ? next
      : t('circlesList', 'last_caught_up_on', {
          date: dayWords(summary.lastMetAt, summary.zone),
          next,
        });

  switch (summaryState(summary, now)) {
    case 'finding_a_time':
      return t('circlesList', 'finding_a_time_replied', {
        count: summary.activePlan?.replied ?? 0,
        total: summary.activePlan?.asked ?? 0,
      });
    case 'locked_in':
      return t('circlesList', 'locked_in_on', {
        date: dateOf(summary.lockedIn?.startsAt ?? '', summary.zone),
      });
    case 'just_you':
      return t('circlesList', 'just_you');
    case 'about_time':
      return t('circlesList', 'about_time');
    case 'never_met':
      return t('circlesList', 'not_caught_up_yet');
    case 'no_goal':
      return lastMet(t('circlesList', 'no_goal_set'));
    case 'no_rush':
      return lastMet(t('circlesList', 'no_rush'));
  }
}

/**
 * "It's been about a month since Sunday Crew last got together. …" — and, to
 * the one person the cadence nudge asked, "It's your turn to plan" (spec
 * §5.9). Everybody else reads the quieter sentence, which names nobody.
 */
export function aboutTimeBody(home: CircleHome): string {
  const period = {
    weekly: t('circleHome', 'period_weekly'),
    fortnightly: t('circleHome', 'period_fortnightly'),
    monthly: t('circleHome', 'period_monthly'),
    two_monthly: t('circleHome', 'period_two_monthly'),
    // `about_time` is never reached with no goal; the words are there anyway.
    none: t('circleHome', 'period_monthly'),
  }[home.cadence];
  return t('circleHome', home.myTurn ? 'about_time_body_your_turn' : 'about_time_body', {
    period,
    circle: home.name,
  });
}

/** The locked-in card: "Thu 17 Sep", then "6:30–8:30 pm · Hope St Radio", then who is going. */
export function lockedInWords(home: CircleHome): {
  date: string;
  time: string;
  detail: string;
  going: string;
} {
  const meetup = home.lockedIn;
  if (meetup === null) return { date: '', time: '', detail: '', going: '' };
  const time = timeOf(meetup.startsAt, meetup.endsAt, home.zone);
  return {
    date: dateOf(meetup.startsAt, home.zone),
    time,
    detail:
      meetup.placeName === null
        ? time
        : t('circleHome', 'time_at_place', { time, place: meetup.placeName }),
    going:
      meetup.toConfirm === 0
        ? t('circleHome', 'going', { going: meetup.going })
        : t('circleHome', 'going_to_confirm', { going: meetup.going, count: meetup.toConfirm }),
  };
}

/** "+12" on a marks row past eight (the candidates screens' cap, ADR 0012). */
export const MARKS_MAX = 8;
export const marksMore = (rest: number) => t('circleHome', 'marks_more', { count: rest });
