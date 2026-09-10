import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { userId } from '../circles/types.js';
import { fromISO, type Instant } from '../shared/instant.js';
import { localDate } from '../shared/local-date.js';
import { MELBOURNE } from '../shared/fixtures.js';
import { toLocal } from '../shared/zone.js';
import { generateCandidates, enumerateCandidateStarts } from './engine.js';
import {
  ALEX,
  JESS,
  NIC,
  PRIYA,
  SAM,
  SUNDAY_CREW,
  TOM,
  NEXT_FORTNIGHT,
  noQuorumInput,
  on,
  sundayCrewInput,
} from './fixtures.js';
import type { EngineInput } from './types.js';

const at = (t: Instant) => {
  const local = toLocal(t, MELBOURNE);
  return `${local.date} ${Math.floor(local.minutesOfDay / 60)}:${String(local.minutesOfDay % 60).padStart(2, '0')}`;
};

describe('the Candidates artboard', () => {
  const set = generateCandidates(sundayCrewInput());

  it('offers the three options the design shows', () => {
    expect(set.eligible).toHaveLength(3);
    expect(set.eligible.map((c) => at(c.start))).toEqual([
      '2026-09-17 18:30', // Thu 17 Sep, 6:30 pm
      '2026-09-19 19:00', // Sat 19 Sep
      '2026-09-20 16:00', // Sun 20 Sep, 4 pm
    ]);
  });

  it('says five of six for Thursday, because Alex has not answered', () => {
    const [thursday] = set.eligible;
    expect(thursday?.availableUserIds).toEqual([SAM, PRIYA, TOM, JESS, NIC]);
    expect(thursday?.availableUserIds).not.toContain(ALEX);
  });

  it('loses Priya on the Saturday and Tom on the Sunday', () => {
    expect(set.eligible[1]?.availableUserIds).not.toContain(PRIYA);
    expect(set.eligible[2]?.availableUserIds).not.toContain(TOM);
  });

  it('explains each option the way the design does', () => {
    // "Best attendance", "One fewer, weekend", "Also four, a day later".
    expect(set.eligible.map((c) => c.explanation)).toEqual([
      { code: 'best_attendance', count: 5 },
      { code: 'one_fewer_weekend', count: 4 },
      { code: 'also_n_later', count: 4 },
    ]);
  });

  it('spreads the options across three dates', () => {
    const dates = set.eligible.map((c) => toLocal(c.start, MELBOURNE).date);
    expect(new Set(dates).size).toBe(3);
  });
});

describe('the NoQuorum artboard', () => {
  const set = generateCandidates(noQuorumInput());

  it('offers nothing and shows the two closest', () => {
    expect(set.eligible).toEqual([]);
    expect(set.nearMisses).toHaveLength(2);
    expect(set.nearMisses.map((n) => at(n.start))).toEqual([
      '2026-09-11 19:00', // Fri 11 Sep, 7 pm
      '2026-09-12 18:30', // Sat 12 Sep, 6:30 pm
    ]);
  });

  it('names the rule that stopped each one', () => {
    for (const miss of set.nearMisses) {
      expect(miss.reason).toEqual({ kind: 'quorum_short', by: 1 });
    }
  });

  it('labels them "closest" and "also three"', () => {
    expect(set.nearMisses.map((n) => n.explanation)).toEqual([
      { code: 'closest', count: 3 },
      { code: 'also_n_later', count: 3 },
    ]);
  });

  it('never offers a time nobody can make', () => {
    for (const miss of set.nearMisses) {
      expect(miss.availableUserIds.length).toBeGreaterThan(0);
    }
  });
});

describe('availability', () => {
  it('needs a window to contain the whole meetup, not merely overlap it', () => {
    // Free 7–8, asked about two hours from 7: that is not a yes.
    const input = sundayCrewInput({
      responses: [[SAM, { status: 'windows', windows: [on('2026-09-17', 19 * 60, 20 * 60)] }]],
      activeMemberIds: [SAM],
      plan: { ...NEXT_FORTNIGHT, quorum: 1 },
    });
    expect(generateCandidates(input).eligible).toEqual([]);
  });

  it('counts a flexible member without letting them constrain the time', () => {
    const input = sundayCrewInput({
      responses: [
        [SAM, { status: 'windows', windows: [on('2026-09-17', 18 * 60, 20 * 60)] }],
        [PRIYA, { status: 'flexible', windows: [] }],
      ],
      activeMemberIds: [SAM, PRIYA],
      plan: { ...NEXT_FORTNIGHT, quorum: 2 },
    });
    const [best] = generateCandidates(input).eligible;
    expect(best?.availableUserIds).toEqual([SAM, PRIYA]);
    expect(best?.explicitCount).toBe(1);
    expect(best?.flexibleCount).toBe(1);
  });

  it('ranks a flexible-only set below an explicit one of the same size', () => {
    const explicitDay = on('2026-09-17', 18 * 60, 20 * 60);
    const input = sundayCrewInput({
      responses: [
        [SAM, { status: 'windows', windows: [explicitDay] }],
        [PRIYA, { status: 'windows', windows: [explicitDay] }],
        [TOM, { status: 'flexible', windows: [] }],
        [JESS, { status: 'flexible', windows: [] }],
      ],
      activeMemberIds: [SAM, PRIYA, TOM, JESS],
      plan: { ...NEXT_FORTNIGHT, quorum: 2 },
    });
    // Every start has the two flexible members; only Thursday 6–8 has the two
    // explicit ones, so it must come first despite the ties elsewhere.
    const [best] = generateCandidates(input).eligible;
    expect(at(best?.start as Instant)).toBe('2026-09-17 18:00');
    expect(best?.explicitCount).toBe(2);
  });

  it('never puts a non-responder in the available set', () => {
    const set = generateCandidates(sundayCrewInput());
    for (const candidate of set.eligible) {
      expect(candidate.availableUserIds).not.toContain(ALEX);
    }
  });

  it('treats none_work, more_notice and not_this_time as unavailable', () => {
    for (const status of ['none_work', 'more_notice', 'not_this_time'] as const) {
      const input = sundayCrewInput({
        responses: [[SAM, { status, windows: [] }]],
        activeMemberIds: [SAM],
        plan: { ...NEXT_FORTNIGHT, quorum: 1 },
      });
      expect(generateCandidates(input).eligible, status).toEqual([]);
    }
  });
});

describe('eligibility', () => {
  it('refuses a time a required member cannot make, however many others can', () => {
    const input = sundayCrewInput({
      plan: { ...NEXT_FORTNIGHT, requiredMemberIds: [ALEX] },
    });
    const set = generateCandidates(input);
    expect(set.eligible).toEqual([]);
    // …and says so, rather than blaming the quorum.
    expect(set.nearMisses[0]?.reason).toEqual({ kind: 'required_missing', userId: ALEX });
  });

  it('reports a missing required member ahead of a quorum shortfall', () => {
    // Lowering the quorum would not help, so that must not be the reason shown.
    const input = sundayCrewInput({
      plan: { ...NEXT_FORTNIGHT, quorum: 6, requiredMemberIds: [ALEX] },
    });
    expect(generateCandidates(input).nearMisses[0]?.reason).toMatchObject({
      kind: 'required_missing',
    });
  });
});

describe('explanations agree with the clock', () => {
  const THU = '2026-09-17';
  const FRI = '2026-09-18';
  const both = () => [on(THU, 18 * 60, 20 * 60), on(FRI, 18 * 60, 20 * 60)];
  const fridayOnly = () => [on(FRI, 18 * 60, 20 * 60)];

  it('says "sooner", not "later", for an option that falls earlier than the best', () => {
    // Ranking is attendance first, so a smaller set can easily land earlier:
    // five on the Friday outranks three on the Thursday. Calling the Thursday
    // "a day later" would simply be false.
    const set = generateCandidates(
      sundayCrewInput({
        plan: { ...NEXT_FORTNIGHT, quorum: 3 },
        responses: [
          [SAM, { status: 'windows', windows: both() }],
          [PRIYA, { status: 'windows', windows: both() }],
          [TOM, { status: 'windows', windows: both() }],
          [JESS, { status: 'windows', windows: fridayOnly() }],
          [NIC, { status: 'windows', windows: fridayOnly() }],
        ],
      }),
    );

    expect(set.eligible.map((c) => [toLocal(c.start, MELBOURNE).date, c.explanation.code])).toEqual(
      [
        ['2026-09-18', 'best_attendance'],
        ['2026-09-17', 'also_n_sooner'],
      ],
    );
  });

  it('never describes an earlier option as later, whatever the ranking', () => {
    const set = generateCandidates(sundayCrewInput());
    const [best] = set.eligible;
    for (const candidate of set.eligible.slice(1)) {
      const isLater = candidate.start > (best as { start: Instant }).start;
      if (candidate.explanation.code.endsWith('_later')) expect(isLater).toBe(true);
      if (candidate.explanation.code.endsWith('_sooner')) expect(isLater).toBe(false);
    }
  });
});

describe('a band running to midnight', () => {
  // `fromLocal` refuses 1440 because no clock reads 24:00, so a band ending at
  // midnight validated and then threw inside cells, shortcuts and the engine.
  // Refusing it would have meant a band could end at 23:30 but not at midnight.
  const DAY = localDate('2026-09-17');
  const lateEvening = {
    ...NEXT_FORTNIGHT,
    window: { start: DAY, end: DAY },
    daily: { startMin: 21 * 60, endMin: 24 * 60 },
    durationMinutes: 60,
  };

  it('enumerates starts up to the last that finishes by midnight', () => {
    expect(enumerateCandidateStarts(lateEvening, fromISO('2026-09-01T00:00:00Z')).map(at)).toEqual([
      '2026-09-17 21:00',
      '2026-09-17 21:30',
      '2026-09-17 22:00',
      '2026-09-17 22:30',
      '2026-09-17 23:00',
    ]);
  });

  it('finds a time in it', () => {
    const set = generateCandidates(
      sundayCrewInput({
        plan: { ...lateEvening, quorum: 1 },
        responses: [[SAM, { status: 'windows', windows: [on('2026-09-17', 22 * 60, 24 * 60)] }]],
        activeMemberIds: [SAM],
      }),
    );
    // Two, an hour apart: 22:30 is dropped because it would overlap 22:00, and
    // 23:00 is the last start that still finishes by midnight.
    expect(set.eligible.map((c) => at(c.start))).toEqual(['2026-09-17 22:00', '2026-09-17 23:00']);
  });
});

describe('enumeration', () => {
  it('skips starts whose meetup would run past the daily band', () => {
    const plan = {
      ...NEXT_FORTNIGHT,
      window: { start: localDate('2026-09-17'), end: localDate('2026-09-17') },
      daily: { startMin: 18 * 60, endMin: 21 * 60 },
    };
    // 18:00, 18:30, 19:00 — a two-hour meetup from 19:30 would end at 21:30.
    const starts = enumerateCandidateStarts(plan, fromISO('2026-09-01T00:00:00Z'));
    expect(starts.map(at)).toEqual(['2026-09-17 18:00', '2026-09-17 18:30', '2026-09-17 19:00']);
  });

  it('skips the past', () => {
    const plan = {
      ...NEXT_FORTNIGHT,
      window: { start: localDate('2026-09-17'), end: localDate('2026-09-17') },
      daily: { startMin: 18 * 60, endMin: 21 * 60 },
    };
    const afterTheFirst = fromISO('2026-09-17T08:15:00Z'); // 18:15 Melbourne
    expect(enumerateCandidateStarts(plan, afterTheFirst).map(at)).toEqual([
      '2026-09-17 18:30',
      '2026-09-17 19:00',
    ]);
  });

  describe('across a daylight-saving change', () => {
    const band = { startMin: 60, endMin: 5 * 60 }; // 01:00–05:00
    const early = fromISO('2026-01-01T00:00:00Z');

    it('has two fewer starts on the day an hour is skipped', () => {
      const day = localDate('2026-10-04'); // Melbourne springs forward
      const plan = {
        ...NEXT_FORTNIGHT,
        window: { start: day, end: day },
        daily: band,
        durationMinutes: 60,
      };
      // 01:00, 01:30, 03:00, 03:30 — a 60-minute meetup from 04:00 ends at
      // 05:00, so that counts too. 02:00 and 02:30 never happen.
      expect(enumerateCandidateStarts(plan, early).map(at)).toEqual([
        '2026-10-04 1:00',
        '2026-10-04 1:30',
        '2026-10-04 3:00',
        '2026-10-04 3:30',
        '2026-10-04 4:00',
      ]);
    });

    it('has two more on the day an hour repeats, because both are real', () => {
      const day = localDate('2026-04-05'); // Melbourne falls back
      const plan = {
        ...NEXT_FORTNIGHT,
        window: { start: day, end: day },
        daily: band,
        durationMinutes: 60,
      };
      const starts = enumerateCandidateStarts(plan, early);
      // Ten slots in the band, of which the last (04:30) cannot fit an hour.
      expect(starts).toHaveLength(9);
      // Both 02:00s are offered, an hour apart in real time.
      const twos = starts.filter((s) => toLocal(s, MELBOURNE).minutesOfDay === 120);
      expect(twos).toHaveLength(2);
      expect((twos[1] as Instant) - (twos[0] as Instant)).toBe(60 * 60_000);
    });
  });
});

describe('determinism', () => {
  it('gives the same answer for the same input, whatever order it arrives in', () => {
    const base = sundayCrewInput();
    fc.assert(
      fc.property(
        fc.shuffledSubarray([...base.responses], { minLength: base.responses.length }),
        (shuffled) => {
          const set = generateCandidates({ ...base, responses: shuffled });
          expect(set).toEqual(generateCandidates(base));
        },
      ),
      { numRuns: 200 },
    );
  });

  it('is stable across many random inputs', () => {
    const days = ['2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'];
    const member = fc.constantFrom(SAM, PRIYA, TOM, JESS, NIC, ALEX);
    const window = fc
      .tuple(fc.constantFrom(...days), fc.integer({ min: 18, max: 20 }))
      .map(([day, hour]) => on(day, hour * 60, (hour + 2) * 60));

    fc.assert(
      fc.property(
        fc.array(fc.tuple(member, fc.array(window, { maxLength: 3 })), { maxLength: 6 }),
        fc.integer({ min: 1, max: 6 }),
        (entries, quorum) => {
          const responses = [
            ...new Map(entries.map(([m, ws]) => [m, { status: 'windows' as const, windows: ws }])),
          ];
          const input: EngineInput = sundayCrewInput({
            responses,
            plan: { ...NEXT_FORTNIGHT, quorum },
          });
          expect(generateCandidates(input)).toEqual(generateCandidates(input));
        },
      ),
      { numRuns: 300 },
    );
  });

  it('hashes the same input the same way, and a changed one differently', () => {
    const base = sundayCrewInput();
    expect(generateCandidates(base).inputHash).toBe(generateCandidates(base).inputHash);
    const changed = sundayCrewInput({ plan: { ...NEXT_FORTNIGHT, quorum: 5 } });
    expect(generateCandidates(changed).inputHash).not.toBe(generateCandidates(base).inputHash);
  });

  it('hashes the same answers the same way however they were ordered', () => {
    const base = sundayCrewInput();
    const reversed = { ...base, responses: [...base.responses].reverse() };
    expect(generateCandidates(reversed).inputHash).toBe(generateCandidates(base).inputHash);
  });
});

describe('performance', () => {
  it('handles eight members across a fortnight well inside 50 ms', () => {
    const members = [...SUNDAY_CREW, userId('kim'), userId('raj')];
    const days = Array.from({ length: 14 }, (_, i) => `2026-09-${String(14 + i).padStart(2, '0')}`);
    const responses = members.map(
      (m) =>
        [
          m,
          { status: 'windows' as const, windows: days.map((d) => on(d, 9 * 60, 22 * 60)) },
        ] as const,
    );
    const input = sundayCrewInput({ responses, activeMemberIds: members });

    const started = performance.now();
    generateCandidates(input);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(50);
  });
});

describe('the set itself', () => {
  it('carries the scoring version, so a changed algorithm is detectable', () => {
    expect(generateCandidates(sundayCrewInput()).scoringVersion).toBe(1);
  });

  it('reports what it looked at', () => {
    const set = generateCandidates(sundayCrewInput());
    expect(set.stats).toMatchObject({
      activeMemberCount: 6,
      respondedCount: 5,
      eligibleCount: 3,
    });
    expect(set.stats.startsConsidered).toBeGreaterThan(0);
  });

  it('has no near-misses when something is eligible', () => {
    expect(generateCandidates(sundayCrewInput()).nearMisses).toEqual([]);
  });

  it('offers nothing at all when nobody has answered', () => {
    const set = generateCandidates(sundayCrewInput({ responses: [] }));
    expect(set.eligible).toEqual([]);
    expect(set.nearMisses).toEqual([]);
  });

  it('never returns more than three', () => {
    const everyone = SUNDAY_CREW.map(
      (m) =>
        [m, { status: 'windows' as const, windows: [on('2026-09-17', 9 * 60, 22 * 60)] }] as const,
    );
    const set = generateCandidates(sundayCrewInput({ responses: everyone }));
    expect(set.eligible.length).toBeLessThanOrEqual(3);
  });

  it('never offers two overlapping times on one date', () => {
    const everyone = SUNDAY_CREW.map(
      (m) =>
        [m, { status: 'windows' as const, windows: [on('2026-09-17', 9 * 60, 22 * 60)] }] as const,
    );
    const set = generateCandidates(sundayCrewInput({ responses: everyone }));
    const byDate = new Map<string, Instant[]>();
    for (const c of set.eligible) {
      const date = toLocal(c.start, MELBOURNE).date;
      byDate.set(date, [...(byDate.get(date) ?? []), c.start]);
    }
    for (const starts of byDate.values()) {
      for (let i = 1; i < starts.length; i += 1) {
        const gap = Math.abs((starts[i] as Instant) - (starts[i - 1] as Instant));
        expect(gap).toBeGreaterThanOrEqual(NEXT_FORTNIGHT.durationMinutes * 60_000);
      }
    }
  });
});
