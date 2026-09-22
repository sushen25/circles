import { fromISO } from '@circles/domain';
import { describe, expect, it } from 'vitest';

import { firstPlanPreview } from './firstPlan';

const MELBOURNE = { zone: 'Australia/Melbourne', defaultDurationMinutes: 120, defaultQuorum: null };

describe('the first plan card', () => {
  it('previews the placeholder quorum a first plan gets, on a circle of one', () => {
    const now = fromISO('2026-09-12T09:00:00Z');
    // What `create-plan` will store (ADR 0026): the floor, not `quorumDefault`'s
    // 2, so the first friend to answer cannot take the plan to ready.
    expect(firstPlanPreview({ ...MELBOURNE, members: 1 }, now).quorum).toBe(3);
    expect(firstPlanPreview({ ...MELBOURNE, members: 2 }, now).quorum).toBe(3);
  });

  it('previews the quorum over the members there are now', () => {
    const now = fromISO('2026-09-12T08:00:00Z');
    expect(firstPlanPreview({ ...MELBOURNE, members: 3 }, now).quorum).toBe(3);
    expect(firstPlanPreview({ ...MELBOURNE, members: 6 }, now).quorum).toBe(4);
  });

  it("uses the circle's own quorum when it has chosen one", () => {
    const now = fromISO('2026-09-12T08:00:00Z');
    expect(firstPlanPreview({ ...MELBOURNE, defaultQuorum: 5, members: 6 }, now).quorum).toBe(5);
  });

  it('closes replies three days after it is made, as the next-14-days preset does', () => {
    const now = fromISO('2026-09-12T08:00:00Z');
    const preview = firstPlanPreview({ ...MELBOURNE, members: 3 }, now);
    expect(preview.deadline).toBe('2026-09-15T08:00:00.000Z');
    expect(preview.band).toEqual({ startMin: 17 * 60 + 30, endMin: 22 * 60 + 30 });
    expect(preview.durationMinutes).toBe(120);
  });
});
