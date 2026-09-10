/**
 * The Sunday Crew, as the Candidates artboard shows them.
 *
 * The artboard is the specification here: six members, quorum four, a two-hour
 * catch-up across the next fortnight, and three options — Thursday 17 September
 * 6:30–8:30 pm with five of six (Alex has not answered), Saturday the 19th with
 * four (not Priya), Sunday the 20th 4–6 pm with four (not Tom). A test that
 * reproduces that is a test that the engine agrees with the design.
 */

import { type UserId, userId } from '../circles/types.js';
import { type Interval, interval } from '../shared/interval.js';
import { fromISO } from '../shared/instant.js';
import { localDate } from '../shared/local-date.js';
import { MELBOURNE } from '../shared/fixtures.js';
import { fromLocal, fromLocalEnd } from '../shared/zone.js';
import type { EngineInput, EnginePlan, MemberResponse } from './types.js';

export const SAM: UserId = userId('sam');
export const PRIYA: UserId = userId('priya');
export const TOM: UserId = userId('tom');
export const JESS: UserId = userId('jess');
export const NIC: UserId = userId('nic');
export const ALEX: UserId = userId('alex');

/** The order the members list renders in, and so the order available sets use. */
export const SUNDAY_CREW: readonly UserId[] = [SAM, PRIYA, TOM, JESS, NIC, ALEX];

const hm = (hours: number, minutes = 0) => hours * 60 + minutes;

/**
 * A willing window on a local date, in local minutes.
 *
 * The end goes through `fromLocalEnd` so that `on(day, 22 * 60, 24 * 60)` means
 * "until midnight" rather than throwing — the same reason a daily band may end
 * there.
 */
export function on(date: string, fromMin: number, toMin: number): Interval {
  return interval(
    fromLocal(localDate(date), fromMin, MELBOURNE),
    fromLocalEnd(localDate(date), toMin, MELBOURNE),
  );
}

/**
 * The artboard's plan: a fortnight, two hours, quorum four — and a band running
 * the whole day rather than the evening default.
 *
 * That band is the point. The design offers Thursday at 6:30 pm *and* Sunday at
 * four in the afternoon in the same plan, which an evenings-only band cannot
 * express. The preset bands are defaults and `custom` is one of the spec's
 * time-of-day options (§5.3), so an organiser who wants the weekend daytime
 * asks for it.
 */
export const NEXT_FORTNIGHT: EnginePlan = {
  window: { start: localDate('2026-09-14'), end: localDate('2026-09-27') },
  daily: { startMin: hm(9), endMin: hm(22, 30) },
  zone: MELBOURNE,
  durationMinutes: 120,
  quorum: 4,
  requiredMemberIds: [],
};

const windows = (...ws: Interval[]): MemberResponse => ({ status: 'windows', windows: ws });

/**
 * Answers that produce the artboard.
 *
 * Thursday works for everyone who answered; Saturday and Sunday each lose one
 * person, and Alex has not answered at all — which is why the first option is
 * five of six rather than six.
 */
export function sundayCrewResponses(): readonly (readonly [UserId, MemberResponse])[] {
  const THU = '2026-09-17';
  const SAT = '2026-09-19';
  const SUN = '2026-09-20';

  // Exact two-hour windows, so the engine has one start per day to find and the
  // times it reports are the times on the artboard rather than an accident of
  // which half hour came first.
  const thursday = () => on(THU, hm(18, 30), hm(20, 30)); // 6:30–8:30 pm
  const saturday = () => on(SAT, hm(19), hm(21)); // 7–9 pm
  const sunday = () => on(SUN, hm(16), hm(18)); // 4–6 pm

  return [
    [SAM, windows(thursday(), saturday(), sunday())],
    // Priya cannot do Saturday.
    [PRIYA, windows(thursday(), sunday())],
    // Tom cannot do Sunday.
    [TOM, windows(thursday(), saturday())],
    [JESS, windows(thursday(), saturday(), sunday())],
    [NIC, windows(thursday(), saturday(), sunday())],
    // Alex has not answered: absent from the responses entirely, which is why
    // the best option is five of six rather than six.
  ];
}

/** Friday of the week before the window, so every start is in the future. */
export const BEFORE_THE_WINDOW = fromISO('2026-09-13T00:00:00Z');

export function sundayCrewInput(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    plan: NEXT_FORTNIGHT,
    responses: sundayCrewResponses(),
    activeMemberIds: SUNDAY_CREW,
    now: BEFORE_THE_WINDOW,
    ...overrides,
  };
}

/**
 * The NoQuorum artboard: six of six replied, quorum four, and nothing reaches
 * it. The closest is Friday 11 September 7–9 pm with three — not Alex, Tom or
 * Sam — and then Saturday the 12th 6:30–8:30 pm, also three, not Priya, Alex or
 * Sam.
 */
export const NEXT_WEEK: EnginePlan = {
  window: { start: localDate('2026-09-07'), end: localDate('2026-09-13') },
  daily: { startMin: hm(9), endMin: hm(22, 30) },
  zone: MELBOURNE,
  durationMinutes: 120,
  quorum: 4,
  requiredMemberIds: [],
};

export function noQuorumInput(): EngineInput {
  const FRI = '2026-09-11';
  const SAT = '2026-09-12';
  const friday = () => on(FRI, hm(19), hm(21)); // 7–9 pm
  const saturday = () => on(SAT, hm(18, 30), hm(20, 30)); // 6:30–8:30 pm

  return {
    plan: NEXT_WEEK,
    // Everybody answered — that is what makes it a no-quorum rather than a
    // waiting state — and no time reaches four.
    responses: [
      [SAM, { status: 'not_this_time', windows: [] }],
      [PRIYA, windows(friday())],
      [TOM, windows(saturday())],
      [JESS, windows(friday(), saturday())],
      [NIC, windows(friday(), saturday())],
      [ALEX, { status: 'none_work', windows: [] }],
    ],
    activeMemberIds: SUNDAY_CREW,
    now: fromISO('2026-09-06T00:00:00Z'),
  };
}
