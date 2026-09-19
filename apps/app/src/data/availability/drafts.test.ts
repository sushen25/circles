import { beforeEach, describe, expect, it } from 'vitest';

import { answerable } from '../fixtures';
import { clearDraft, readDraft, writeDraft } from './drafts';

/**
 * A draft is somebody's week on a shared device, so the tests are about whose
 * it is and which question it answers, as much as about surviving a reload.
 */

const { plan } = answerable;
const MONDAY = { start: '2026-09-14T08:30:00.000Z', end: '2026-09-14T12:30:00.000Z' };
const KEY = '5f0c7c3e-6b0e-4c8e-9a7a-0c7a1d2b3c4d';

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
