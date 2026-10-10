import { describe, expect, it } from 'vitest';

import { viewOf, type CandidateRow } from './rows';

const NEAR: CandidateRow = {
  id: '2026-09-17T08:30:00.000Z',
  startsAt: '2026-09-17T08:30:00.000Z',
  endsAt: '2026-09-17T10:30:00.000Z',
  rank: 1,
  availableUserIds: ['maya'],
  explanationCode: 'closest',
  explanationCount: 1,
  nearMissReason: { kind: 'quorum_short', by: 2 },
};

describe('viewOf, when only near-misses exist', () => {
  it('is still collecting while only the organiser has answered a defaulted quorum of three', () => {
    // A circle of one, quorum_source = 'defaulted' (ADR 0026).
    expect(
      viewOf('collecting', [], [NEAR], { quorum: 3, answeredCount: 1, repliesOpen: true }),
    ).toBe('collecting');
  });

  it('is no_quorum once the quorum has answered and nothing reached it', () => {
    expect(
      viewOf('collecting', [], [NEAR], { quorum: 3, answeredCount: 3, repliesOpen: true }),
    ).toBe('no_quorum');
  });

  it('is no_quorum once replies have closed', () => {
    expect(
      viewOf('collecting', [], [NEAR], { quorum: 3, answeredCount: 1, repliesOpen: false }),
    ).toBe('no_quorum');
  });

  it('leaves ready and closed alone', () => {
    const asking = { quorum: 3, answeredCount: 1, repliesOpen: true };
    expect(viewOf('collecting', [NEAR], [], asking)).toBe('ready');
    expect(viewOf('cancelled', [], [NEAR], asking)).toBe('closed');
    expect(viewOf('collecting', [], [], asking)).toBe('collecting');
  });
});
