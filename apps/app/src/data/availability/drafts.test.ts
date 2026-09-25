import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { answerable } from '../fixtures';
import {
  clearDraft,
  flushDrafts,
  readDraft,
  saveDraftSoon,
  setDraftStoreForTests,
  writeDraft,
} from './drafts';
import type { DraftStore } from './draftStorePort';

/**
 * A draft is somebody's week on a shared device, so the tests are about whose
 * it is and which question it answers, as much as about surviving a reload.
 */

const { plan } = answerable;
const MONDAY = { start: '2099-09-14T08:30:00.000Z', end: '2099-09-14T12:30:00.000Z' };
// Made at run time: a fixed key-shaped literal is what a secret scanner looks for.
const KEY = globalThis.crypto.randomUUID();

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe('drafts', () => {
  it('comes back after a reload with what was painted, the question, and the send in flight', async () => {
    await writeDraft('priya', plan.code, {
      plan,
      windows: [MONDAY],
      flexible: false,
      pending: { status: 'windows', idempotencyKey: KEY as never },
    });

    const draft = await readDraft('priya', plan.code);
    expect(draft?.windows).toEqual([MONDAY]);
    expect(draft?.plan.revision).toBe(plan.revision);
    expect(draft?.pending?.idempotencyKey).toBe(KEY);
  });

  it("is nobody else's: the next person on the same browser sees none", async () => {
    await writeDraft('priya', plan.code, { plan, windows: [MONDAY], flexible: false });

    expect(await readDraft('tom', plan.code)).toBeUndefined();
  });

  it('keeps the revision it answered, so a changed plan finds it and can say so', async () => {
    await writeDraft('priya', plan.code, { plan, windows: [MONDAY], flexible: false });

    // Found under the code whatever the plan's revision is now; the caller
    // compares, and discards it with a notice.
    expect((await readDraft('priya', plan.code))?.plan.revision).toBe(1);
  });

  it('throws away something it cannot read rather than showing it wrongly', async () => {
    globalThis.localStorage.setItem(`circles.answer-draft.priya.${plan.code}`, '{"v":0}');

    expect(await readDraft('priya', plan.code)).toBeUndefined();
    expect(globalThis.localStorage.getItem(`circles.answer-draft.priya.${plan.code}`)).toBeNull();
  });

  it('is gone once cleared', async () => {
    await writeDraft('priya', plan.code, { plan, windows: [MONDAY], flexible: true });
    await clearDraft('priya', plan.code);

    expect(await readDraft('priya', plan.code)).toBeUndefined();
  });
});

/**
 * The app's store (MMKV) coalesces; this one stands in for it with the same
 * port and counts what reaches it.
 */
function countingStore(coalesceMs = 250) {
  const map = new Map<string, string>();
  const calls = { set: 0, remove: [] as string[] };
  const store: DraftStore = {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      calls.set += 1;
      map.set(key, value);
    },
    remove: (key) => {
      calls.remove.push(key);
      map.delete(key);
    },
    coalesceMs,
  };
  return { store, map, calls };
}

describe('drafts on a coalescing store', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    setDraftStoreForTests();
    vi.useRealTimers();
  });

  it('writes a burst of paints once, with the last state', async () => {
    const { store, map, calls } = countingStore();
    setDraftStoreForTests(store);

    for (let cells = 1; cells <= 12; cells += 1) {
      saveDraftSoon('priya', plan.code, {
        plan,
        windows: Array.from({ length: cells }, () => MONDAY),
        flexible: false,
      });
    }
    expect(calls.set).toBe(0);
    // Read before the write lands: it is the painted state, not what is on disk.
    expect((await readDraft('priya', plan.code))?.windows).toHaveLength(12);

    vi.advanceTimersByTime(250);
    expect(calls.set).toBe(1);
    expect(
      JSON.parse(map.get(`circles.answer-draft.priya.${plan.code}`) ?? '{}').windows,
    ).toHaveLength(12);
  });

  it('a send writes straight through and nothing stale lands after it', async () => {
    const { store, map, calls } = countingStore();
    setDraftStoreForTests(store);

    saveDraftSoon('priya', plan.code, { plan, windows: [], flexible: false });
    await writeDraft('priya', plan.code, {
      plan,
      windows: [MONDAY],
      flexible: false,
      pending: { status: 'windows', idempotencyKey: KEY as never },
    });
    expect(calls.set).toBe(1);

    vi.advanceTimersByTime(1_000);
    expect(calls.set).toBe(1);
    const onDisk = JSON.parse(map.get(`circles.answer-draft.priya.${plan.code}`) ?? '{}');
    expect(onDisk.pending.idempotencyKey).toBe(KEY);
  });

  it('flushes what is held when asked (the app leaving the foreground)', () => {
    const { store, calls } = countingStore();
    setDraftStoreForTests(store);

    saveDraftSoon('priya', plan.code, { plan, windows: [MONDAY], flexible: false });
    flushDrafts();
    expect(calls.set).toBe(1);
  });

  it("clearing deletes only this draft's key, and drops a held write for it", async () => {
    const { store, map, calls } = countingStore();
    setDraftStoreForTests(store);
    map.set('circles.session', 'someone-else');
    await writeDraft('tom', plan.code, { plan, windows: [MONDAY], flexible: false });

    saveDraftSoon('priya', plan.code, { plan, windows: [MONDAY], flexible: false });
    await clearDraft('priya', plan.code);
    vi.advanceTimersByTime(1_000);

    expect(calls.remove).toEqual([`circles.answer-draft.priya.${plan.code}`]);
    expect(await readDraft('priya', plan.code)).toBeUndefined();
    expect(await readDraft('tom', plan.code)).toBeDefined();
    expect(map.get('circles.session')).toBe('someone-else');
  });
});

describe('drafts on the web store', () => {
  it('does not hold a paint: a reload straight after it still finds it', async () => {
    saveDraftSoon('priya', plan.code, { plan, windows: [MONDAY], flexible: false });
    expect(
      globalThis.localStorage.getItem(`circles.answer-draft.priya.${plan.code}`),
    ).not.toBeNull();
  });
});
