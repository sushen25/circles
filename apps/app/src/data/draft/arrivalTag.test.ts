import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('../auth/storage', () => ({
  sessionStorage: {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => void store.set(key, value),
    removeItem: async (key: string) => void store.delete(key),
  },
}));

const { ARRIVAL_TAG_KEY, ARRIVAL_TAG_TTL_MS, clearArrivalTag, keepArrivalTag, readArrivalTag } =
  await import('./arrivalTag');

beforeEach(() => store.clear());

describe('the campaign tag kept on arrival (SUS-240)', () => {
  it('keeps a slug and reads it back', async () => {
    await keepArrivalTag('tt-always-the-one-3');
    expect(await readArrivalTag()).toBe('tt-always-the-one-3');
  });

  it.each(['', 'Has Caps', 'a'.repeat(41), 'a b', 'maya@example.com', undefined, ['tt-a'], 3])(
    'keeps nothing for %j',
    async (value) => {
      await keepArrivalTag(value);
      expect(store.size).toBe(0);
      expect(await readArrivalTag()).toBeUndefined();
    },
  );

  it('keeps the first tag of a visit: a second link does not rewrite where it began', async () => {
    await keepArrivalTag('tt-first');
    await keepArrivalTag('rd-second');
    expect(await readArrivalTag()).toBe('tt-first');
  });

  it('is gone a day after it was kept, and removed when read past that', async () => {
    const at = 1_000_000;
    await keepArrivalTag('tt-a', at);
    expect(await readArrivalTag(at + ARRIVAL_TAG_TTL_MS - 1)).toBe('tt-a');
    expect(await readArrivalTag(at + ARRIVAL_TAG_TTL_MS)).toBeUndefined();
    expect(store.has(ARRIVAL_TAG_KEY)).toBe(false);
    await keepArrivalTag('rd-b', at + ARRIVAL_TAG_TTL_MS + 1);
    expect(await readArrivalTag(at + ARRIVAL_TAG_TTL_MS + 2)).toBe('rd-b');
  });

  it('reads a damaged or foreign record as none, and clears it', async () => {
    store.set(ARRIVAL_TAG_KEY, '{not json');
    expect(await readArrivalTag()).toBeUndefined();
    store.set(ARRIVAL_TAG_KEY, JSON.stringify({ tag: 'Not A Slug', at: Date.now() }));
    expect(await readArrivalTag()).toBeUndefined();
    expect(store.has(ARRIVAL_TAG_KEY)).toBe(false);
  });

  it('is cleared once the circle is made', async () => {
    await keepArrivalTag('tt-a');
    await clearArrivalTag();
    expect(await readArrivalTag()).toBeUndefined();
  });

  it('holds only the slug and the time', async () => {
    await keepArrivalTag('tt-a', 5);
    expect(JSON.parse(store.get(ARRIVAL_TAG_KEY) ?? '{}')).toEqual({ tag: 'tt-a', at: 5 });
  });
});
