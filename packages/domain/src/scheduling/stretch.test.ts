import { describe, expect, it } from 'vitest';

import { localDate } from '../shared/local-date.js';
import { MELBOURNE } from '../shared/fixtures.js';
import { fromLocal } from '../shared/zone.js';
import { generateCandidates } from './engine.js';
import {
  ALEX,
  JESS,
  NIC,
  NINA,
  SAM,
  SUNDAY_CREW,
  TOM,
  sundayCrewInput,
  sundayCrewResponses,
} from './fixtures.js';
import { whoCanMake } from './stretch.js';

const at = (date: string, hour: number, minute = 0) =>
  fromLocal(localDate(date), hour * 60 + minute, MELBOURNE);

const crew = { responses: sundayCrewResponses(), activeMemberIds: SUNDAY_CREW };

describe('whoCanMake', () => {
  it('is the Thursday on the Candidates artboard: five can, Alex has not answered', () => {
    const result = whoCanMake(crew, at('2026-09-17', 18, 30), at('2026-09-17', 20, 30));
    expect(result.available).toEqual([SAM, NINA, TOM, JESS, NIC]);
    expect(result.awaiting).toEqual([ALEX]);
    expect(result.cannot).toEqual([]);
  });

  it('says "cannot" for somebody who answered other times, and never for somebody who did not answer', () => {
    // Saturday 7-9 pm: Nina marked Thursday and Sunday, not Saturday.
    const result = whoCanMake(crew, at('2026-09-19', 19), at('2026-09-19', 21));
    expect(result.available).toEqual([SAM, TOM, JESS, NIC]);
    expect(result.cannot).toEqual([NINA]);
    expect(result.awaiting).toEqual([ALEX]);
  });

  it('needs a window that contains the whole stretch, not one that overlaps it', () => {
    // Thursday 7-9 pm runs past the 6:30-8:30 pm windows.
    const result = whoCanMake(crew, at('2026-09-17', 19), at('2026-09-17', 21));
    expect(result.available).toEqual([]);
    expect(result.cannot).toEqual([SAM, NINA, TOM, JESS, NIC]);
  });

  it('counts "I\'m easy" without any window, in members-list order', () => {
    const easy = {
      responses: [
        ...sundayCrewResponses().filter(([user]) => user !== NINA),
        [NINA, { status: 'flexible', windows: [] }] as const,
      ],
      activeMemberIds: SUNDAY_CREW,
    } as const;
    const result = whoCanMake(easy, at('2026-09-26', 10), at('2026-09-26', 11));
    expect(result.flexible).toEqual([NINA]);
    expect(result.available).toEqual([NINA]);
    expect(result.cannot).toEqual([SAM, TOM, JESS, NIC]);
  });

  it('ignores an answer from somebody the plan is no longer asking', () => {
    const result = whoCanMake(
      { ...crew, activeMemberIds: SUNDAY_CREW.filter((id) => id !== TOM) },
      at('2026-09-17', 18, 30),
      at('2026-09-17', 20, 30),
    );
    expect(result.available).not.toContain(TOM);
    expect(result.cannot).not.toContain(TOM);
    expect(result.awaiting).toEqual([ALEX]);
  });

  it('agrees with the engine on every candidate it offers, which is the point of there being one rule', () => {
    const input = sundayCrewInput();
    const set = generateCandidates(input);
    expect(set.eligible.length).toBeGreaterThan(0);
    for (const candidate of set.eligible) {
      expect(whoCanMake(input, candidate.start, candidate.end).available).toEqual(
        candidate.availableUserIds,
      );
    }
  });
});
