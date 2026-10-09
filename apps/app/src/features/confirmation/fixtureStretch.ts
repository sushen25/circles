import {
  fromLocal,
  interval,
  localDate,
  whoCanMake,
  zone as toZone,
  type OthersSaid,
  type UserId,
} from '@circles/domain';

import type { Stretch } from '../../data/confirmation';

/**
 * What Sunday Crew said, for the picker in a build with no backend: the numbers
 * the design's board shows (ADR 0051). Times are on the Melbourne clock, as hours
 * and minutes, on days of September 2026; Alex has not answered.
 *
 * The *who* is the domain's own `whoCanMake`, the function the engine calls and
 * the database mirrors, so the fixture cannot say something the product would not.
 */

const ZONE = toZone('Australia/Melbourne');
const uid = (id: string) => id as UserId;
const at = (day: number, hour: number, minute = 0) =>
  fromLocal(localDate(`2026-09-${String(day).padStart(2, '0')}`), hour * 60 + minute, ZONE);
const win = (day: number, from: [number, number], to: [number, number]) =>
  interval(at(day, ...from), at(day, ...to));

const RESPONSES = [
  [
    uid('maya'),
    {
      status: 'windows' as const,
      windows: [
        win(15, [17, 30], [22, 30]),
        win(17, [18, 30], [22, 30]),
        win(19, [12, 0], [22, 30]),
        win(20, [9, 0], [20, 0]),
      ],
    },
  ],
  [
    uid('nina'),
    {
      status: 'windows' as const,
      windows: [
        win(16, [17, 30], [20, 30]),
        win(17, [17, 30], [21, 0]),
        win(18, [19, 0], [22, 30]),
        win(20, [14, 0], [19, 0]),
      ],
    },
  ],
  [
    uid('tom'),
    {
      status: 'windows' as const,
      windows: [
        win(17, [18, 30], [20, 30]),
        win(18, [17, 30], [22, 30]),
        win(19, [17, 30], [22, 30]),
      ],
    },
  ],
  [
    uid('jess'),
    {
      status: 'windows' as const,
      windows: [
        win(15, [18, 30], [21, 30]),
        win(17, [18, 0], [22, 30]),
        win(19, [15, 0], [21, 0]),
        win(20, [12, 0], [18, 0]),
      ],
    },
  ],
  [
    uid('sam'),
    {
      status: 'windows' as const,
      windows: [win(17, [17, 30], [20, 30]), win(19, [14, 0], [20, 30]), win(20, [15, 0], [20, 0])],
    },
  ],
] as const;

const MEMBERS = ['maya', 'nina', 'tom', 'jess', 'sam', 'alex'].map(uid);

export function fixtureStretch(startsAt: string, endsAt: string): Stretch {
  const { available, cannot, awaiting } = whoCanMake(
    { responses: RESPONSES, activeMemberIds: MEMBERS },
    Date.parse(startsAt) as never,
    Date.parse(endsAt) as never,
  );
  return {
    available: [...available],
    cannot: [...cannot],
    awaiting: [...awaiting],
    inputVersion: 5,
    revision: 1,
  };
}

/** The others, as Maya reads them: each person's windows on each day, nobody named. */
export const fixtureOthers: OthersSaid = {
  asked: 6,
  answered: 4,
  withTimes: 4,
  flexible: 0,
  readerAnswered: true,
  days: RESPONSES.filter(([id]) => id !== 'maya').flatMap(([, response]) => {
    const byDay = new Map<string, ReturnType<typeof win>[]>();
    for (const window of response.windows) {
      const day = String(Math.floor(window.start / 86_400_000));
      byDay.set(day, [...(byDay.get(day) ?? []), window]);
    }
    return [...byDay.values()];
  }),
};
