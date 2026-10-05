import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionStorage } from '../auth/storage';

import {
  DEFAULT_PLAN,
  DRAFT_KEY,
  DRAFT_TTL_MS,
  clearDraft,
  readDraft,
  saveDraft,
  type DraftPlan,
} from './organiserDraft';

/**
 * The first run's draft (ADR 0053): what a person typed before there was an
 * account, kept on this device, back after a reload, gone a day after the last
 * change.
 */

const NOW = Date.UTC(2026, 9, 3, 2, 0, 0);

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe('the organiser draft', () => {
  it('is empty until something is typed', async () => {
    expect(await readDraft(NOW)).toBeNull();
  });

  it('persists, and comes back after a reload with what was typed', async () => {
    const { created } = await saveDraft({ circleName: 'Sunday Crew', cadence: 'weekly' }, NOW);
    expect(created).toBe(true);

    // A reload is a new read from storage, with nothing held in memory.
    const restored = await readDraft(NOW + 60_000);
    expect(restored).toMatchObject({
      circleName: 'Sunday Crew',
      cadence: 'weekly',
      plan: DEFAULT_PLAN,
      proceed: false,
    });
  });

  it('says it created the draft once, not on every change', async () => {
    expect((await saveDraft({ circleName: 'S' }, NOW)).created).toBe(true);
    expect((await saveDraft({ circleName: 'Su' }, NOW + 1_000)).created).toBe(false);
  });

  it('expires 24 hours after the last change, and the record is removed', async () => {
    await saveDraft({ circleName: 'Sunday Crew' }, NOW);

    expect(await readDraft(NOW + DRAFT_TTL_MS - 1)).not.toBeNull();
    expect(await readDraft(NOW + DRAFT_TTL_MS)).toBeNull();
    expect(globalThis.localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('runs the 24 hours from the last change, not from the first', async () => {
    await saveDraft({ circleName: 'Sunday Crew' }, NOW);
    const hour23 = NOW + DRAFT_TTL_MS - 3_600_000;
    await saveDraft({ cadence: 'fortnightly' }, hour23);

    expect(await readDraft(NOW + DRAFT_TTL_MS + 3_600_000)).not.toBeNull();
    expect(await readDraft(hour23 + DRAFT_TTL_MS)).toBeNull();
  });

  it('throws away a record it cannot read rather than showing it wrongly', async () => {
    globalThis.localStorage.setItem(DRAFT_KEY, '{"v":0}');
    expect(await readDraft(NOW)).toBeNull();
    expect(globalThis.localStorage.getItem(DRAFT_KEY)).toBeNull();

    globalThis.localStorage.setItem(DRAFT_KEY, 'not json');
    expect(await readDraft(NOW)).toBeNull();
  });

  it('keeps the same keys for the same request, so a resumed finish is the same finish', async () => {
    const first = await saveDraft({ circleName: 'Sunday Crew' }, NOW);
    const again = await saveDraft({ way: 'ask', proceed: true }, NOW + 1_000);

    expect(again.draft.keys).toEqual(first.draft.keys);
  });

  it('makes new keys when what the request says changes', async () => {
    const first = await saveDraft({ circleName: 'Sunday Crew' }, NOW);

    const renamed = await saveDraft({ circleName: 'Sunday Club' }, NOW + 1_000);
    expect(renamed.draft.keys.circle).not.toBe(first.draft.keys.circle);
    expect(renamed.draft.keys.plan).not.toBe(first.draft.keys.plan);

    const elsewhen = await saveDraft(
      { plan: { ...DEFAULT_PLAN, preset: 'this_weekend' } },
      NOW + 2_000,
    );
    expect(elsewhen.draft.keys.circle).toBe(renamed.draft.keys.circle);
    expect(elsewhen.draft.keys.plan).not.toBe(renamed.draft.keys.plan);
  });

  it('holds the whole plan setup, and a reload brings all of it back', async () => {
    const plan: DraftPlan = {
      category: 'dinner',
      preset: 'custom',
      custom: { start: '2026-10-09', end: '2026-10-16', days: ['2026-10-09', '2026-10-16'] },
      band: { startMin: 18 * 60, endMin: 22 * 60 },
      duration: 180,
      deadline: '2026-10-08T08:00:00.000Z',
    };
    await saveDraft({ circleName: 'Sunday Crew', plan }, NOW);

    expect((await readDraft(NOW + 60_000))?.plan).toEqual(plan);
  });

  it('treats a draft in the old format as no draft, rather than crashing on it', async () => {
    // Version 1 held a preset and nothing else of the plan.
    globalThis.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        v: 1,
        updatedAt: NOW,
        circleName: 'Sunday Crew',
        cadence: 'weekly',
        preset: 'this_weekend',
        proceed: false,
        circleCounted: false,
        keys: { circle: globalThis.crypto.randomUUID(), plan: globalThis.crypto.randomUUID() },
      }),
    );

    expect(await readDraft(NOW + 1_000)).toBeNull();
    expect(globalThis.localStorage.getItem(DRAFT_KEY)).toBeNull();
    // And the next draft starts clean, in the new format.
    expect((await saveDraft({ circleName: 'Sunday Crew' }, NOW + 2_000)).created).toBe(true);
    expect(await readDraft(NOW + 3_000)).toMatchObject({ v: 2, plan: DEFAULT_PLAN });
  });

  it('makes a new plan key for any change to the setup, and keeps it when nothing changed', async () => {
    const first = await saveDraft({ circleName: 'Sunday Crew' }, NOW);
    const longer = await saveDraft({ plan: { ...DEFAULT_PLAN, duration: 180 } }, NOW + 1_000);
    expect(longer.draft.keys.plan).not.toBe(first.draft.keys.plan);
    expect(longer.draft.keys.circle).toBe(first.draft.keys.circle);

    // The same setup, written again with its fields in another order.
    const again = await saveDraft(
      { plan: { duration: 180, preset: 'next_14_days', category: 'catch_up' } },
      NOW + 2_000,
    );
    expect(again.draft.keys.plan).toBe(longer.draft.keys.plan);

    const later = await saveDraft(
      { plan: { ...longer.draft.plan, deadline: '2026-10-08T08:00:00.000Z' } },
      NOW + 3_000,
    );
    expect(later.draft.keys.plan).not.toBe(longer.draft.keys.plan);
  });

  it('renews the 24 hours on an edit to the setup', async () => {
    await saveDraft({ circleName: 'Sunday Crew' }, NOW);
    const hour23 = NOW + DRAFT_TTL_MS - 3_600_000;
    await saveDraft({ plan: { ...DEFAULT_PLAN, duration: 90 } }, hour23);
    expect(await readDraft(NOW + DRAFT_TTL_MS + 3_600_000)).not.toBeNull();
  });

  it('forgets that the circle was counted when the circle changes', async () => {
    await saveDraft({ circleName: 'Sunday Crew' }, NOW);
    await saveDraft({ circleCounted: true }, NOW);
    expect((await saveDraft({ way: 'ask' }, NOW + 1_000)).draft.circleCounted).toBe(true);
    expect((await saveDraft({ circleName: 'Sunday Club' }, NOW + 2_000)).draft.circleCounted).toBe(
      false,
    );
  });

  it('goes on from memory when the device refuses the write, rather than losing the draft', async () => {
    const write = vi.spyOn(sessionStorage, 'setItem').mockRejectedValue(new Error('storage'));
    vi.spyOn(sessionStorage, 'getItem').mockResolvedValue(null);
    try {
      await saveDraft({ circleName: 'Sunday Crew', cadence: 'weekly' }, NOW);
      expect(await readDraft(NOW + 1_000)).toMatchObject({ circleName: 'Sunday Crew' });

      await clearDraft();
      expect(await readDraft(NOW + 2_000)).toBeNull();
    } finally {
      write.mockRestore();
      vi.restoreAllMocks();
    }
  });

  it('stays cleared when the device refuses the deletion, and tries again', async () => {
    await saveDraft({ circleName: 'Sunday Crew' }, NOW);
    const remove = vi
      .spyOn(sessionStorage, 'removeItem')
      .mockRejectedValueOnce(new Error('storage'));
    try {
      await clearDraft();
      // Refused once: the record is on disk, and is not handed back. The next
      // read tries the removal again, which now takes.
      expect(await readDraft(NOW + 1_000)).toBeNull();
      expect(remove).toHaveBeenCalledTimes(2);
      expect(globalThis.localStorage.getItem(DRAFT_KEY)).toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('is cleared when asked', async () => {
    await saveDraft({ circleName: 'Sunday Crew' }, NOW);
    await clearDraft();
    expect(await readDraft(NOW)).toBeNull();
  });

  describe('on a storage adapter that answers slowly (native secure storage)', () => {
    /** Every call to the adapter takes a few turns of the event loop to land. */
    function slowStorage(): void {
      const real = {
        get: sessionStorage.getItem.bind(sessionStorage),
        set: sessionStorage.setItem.bind(sessionStorage),
        remove: sessionStorage.removeItem.bind(sessionStorage),
      };
      const later = () => new Promise<void>((resolve) => setTimeout(resolve, 10));
      vi.spyOn(sessionStorage, 'getItem').mockImplementation(async (key) => {
        const value = await real.get(key);
        await later();
        return value;
      });
      vi.spyOn(sessionStorage, 'setItem').mockImplementation(async (key, value) => {
        await later();
        await real.set(key, value);
      });
      vi.spyOn(sessionStorage, 'removeItem').mockImplementation(async (key) => {
        await later();
        await real.remove(key);
      });
    }

    it('keeps both changes when two writes overlap', async () => {
      slowStorage();
      try {
        // A preset chip, then the setup's Save, without waiting for the chip.
        const chip = saveDraft({ circleName: 'Sunday Crew' }, NOW);
        const save = saveDraft({ cadence: 'weekly' }, NOW + 1);
        const [first, second] = await Promise.all([chip, save]);

        expect(first.created).toBe(true);
        expect(second.created).toBe(false);
        expect(await readDraft(NOW + 2)).toMatchObject({
          circleName: 'Sunday Crew',
          cadence: 'weekly',
        });
        expect(JSON.parse(globalThis.localStorage.getItem(DRAFT_KEY) ?? 'null')).toMatchObject({
          circleName: 'Sunday Crew',
          cadence: 'weekly',
        });
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('never brings back a draft that was cleared while a write was in flight', async () => {
      await saveDraft({ circleName: 'Sunday Crew' }, NOW);
      slowStorage();
      try {
        const inFlight = saveDraft({ cadence: 'weekly' }, NOW + 1);
        const cleared = clearDraft();
        await Promise.all([inFlight, cleared]);

        expect(await readDraft(NOW + 2)).toBeNull();
        expect(globalThis.localStorage.getItem(DRAFT_KEY)).toBeNull();
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('lets a write that comes after the clear start a fresh draft', async () => {
      await saveDraft({ circleName: 'Sunday Crew' }, NOW);
      slowStorage();
      try {
        const cleared = clearDraft();
        const fresh = saveDraft({ cadence: 'weekly' }, NOW + 1);
        await Promise.all([cleared, fresh]);

        expect((await fresh).created).toBe(true);
        expect(await readDraft(NOW + 2)).toMatchObject({ circleName: '', cadence: 'weekly' });
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('does not renew the 24 hours by being read, even while a write is waiting', async () => {
      await saveDraft({ circleName: 'Sunday Crew' }, NOW);
      slowStorage();
      try {
        const reads = Promise.all([readDraft(NOW + 1_000), readDraft(NOW + DRAFT_TTL_MS - 1)]);
        await reads;
        expect(await readDraft(NOW + DRAFT_TTL_MS)).toBeNull();
      } finally {
        vi.restoreAllMocks();
      }
    });
  });
});
