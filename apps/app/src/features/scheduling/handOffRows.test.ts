import { describe, expect, it } from 'vitest';

import { handOffRowsOf } from './deadline';

describe('the hand-off sheet (ADR 0060)', () => {
  it('greys a guest, with why, when the organiser is told who has saved a place', () => {
    const rows = handOffRowsOf(
      [
        { userId: 'nina', name: 'Nina', hasSavedPlace: true },
        { userId: 'sam', name: 'Sam', hasSavedPlace: false },
      ],
      'maya',
    );
    expect(rows.map((r) => [r.name, r.available])).toEqual([
      ['Nina', true],
      ['Sam', false],
    ]);
    expect(rows[1]?.detail).toBeDefined();
  });

  it('offers everybody when it is not told, and says nothing about anyone', () => {
    const rows = handOffRowsOf(
      [
        { userId: 'nina', name: 'Nina', hasSavedPlace: null },
        { userId: 'sam', name: 'Sam', hasSavedPlace: null },
      ],
      'maya',
    );
    expect(rows.every((r) => r.available && r.detail === undefined)).toBe(true);
  });
});
