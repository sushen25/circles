import { describe, expect, it } from 'vitest';

/**
 * Every "We couldn't load…" screen is the shared error block (SUS-200): a screen
 * that renders its own heading and Try again is a screen with no reference and
 * no second way out, which is how the founder found out about all ten of them.
 *
 * Reads every screen's source (found by Vite, so no test reads the disk itself)
 * and fails a `couldnt_load` that is not the `message` of a `<LoadFailed`.
 * `link_couldnt_load` is a row inside Settings, not a screen, and is left alone.
 */
const SOURCES = import.meta.glob(['/src/features/**/*.tsx', '!/**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const USES = /(?<![\w])(?:'couldnt_load'|"couldnt_load"|`couldnt_load`)/g;

describe('every couldnt_load screen uses the shared error block', () => {
  const found = Object.entries(SOURCES)
    .filter(([file]) => !file.endsWith('/system/LoadFailed.tsx'))
    .filter(([, text]) => [...text.matchAll(USES)].length > 0);

  it('finds the screens it is meant to guard', () => {
    // 26 screens and the states shared by several: if this drops, the glob broke.
    expect(found.length).toBeGreaterThanOrEqual(25);
  });

  it.each(found.map(([file]) => file))('%s renders it through <LoadFailed>', (file) => {
    const text = SOURCES[file]!;
    for (const use of text.matchAll(USES)) {
      const before = text.slice(Math.max(0, use.index - 260), use.index);
      expect(before, `${file}: couldnt_load outside a <LoadFailed message=…>`).toMatch(
        /<LoadFailed[\s\S]*message=\{/,
      );
    }
  });
});
