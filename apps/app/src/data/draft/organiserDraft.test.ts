import { beforeEach, describe, expect, it } from 'vitest';

import { DRAFT_KEY, DRAFT_TTL_MS, clearDraft, readDraft, saveDraft } from './organiserDraft';

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
      preset: 'next_14_days',
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

    const elsewhen = await saveDraft({ preset: 'this_weekend' }, NOW + 2_000);
    expect(elsewhen.draft.keys.circle).toBe(renamed.draft.keys.circle);
    expect(elsewhen.draft.keys.plan).not.toBe(renamed.draft.keys.plan);
  });

  it('forgets that the circle was counted when the circle changes', async () => {
    await saveDraft({ circleName: 'Sunday Crew' }, NOW);
    await saveDraft({ circleCounted: true }, NOW);
    expect((await saveDraft({ way: 'ask' }, NOW + 1_000)).draft.circleCounted).toBe(true);
    expect((await saveDraft({ circleName: 'Sunday Club' }, NOW + 2_000)).draft.circleCounted).toBe(
      false,
    );
  });

  it('is cleared when asked', async () => {
    await saveDraft({ circleName: 'Sunday Crew' }, NOW);
    await clearDraft();
    expect(await readDraft(NOW)).toBeNull();
  });
});
