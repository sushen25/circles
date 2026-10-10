/**
 * Which live specs run in which of the five projects (SUS-179).
 *
 * The live suite took 15.6 of CI's 27 minutes because every spec ran in all
 * four browser projects, plus the en-AU subset. Most journeys do not depend on
 * the user agent or the locale, so they run in the two engines (Chromium as
 * `android-chrome`, WebKit as `iphone-safari`) and the other three projects run
 * only the specs that exercise what those projects differ on.
 *
 * **A spec says so itself**, on its first lines, and the config reads it:
 *
 *     // @e2e: core
 *     // @e2e: in-app-browser
 *     // @e2e: in-app-browser, locale
 *
 * - `core`: Chromium and WebKit. Nothing in the journey depends on which app
 *   opened the link or on the browser's locale.
 * - `in-app-browser`: also `whatsapp-android` and `messenger-ios`. The journey
 *   meets the user agent: the in-app guard, the share sheet, being sent back
 *   in after storage was cleared, a link opened inside a chat.
 * - `locale`: also `iphone-safari-en-au`. The screens write dates, or the page
 *   is one a link from a chat lands on (a browser in another locale than the
 *   export's must hydrate cleanly, SUS-90).
 *
 * `core` stands alone; the other two combine. **A spec with no line fails**
 * (`problems`, run by `pnpm check:workflows`), because the default for a new
 * spec must not be a silent absence from three projects: whoever writes one
 * decides, and a spec that arrives from another branch at a rebase is caught
 * there. A spec tagged `core` whose code reads the user agent, the share sheet
 * or the second locale fails too.
 *
 * Plain Node (`--experimental-strip-types`) and Playwright both load this file,
 * so it imports nothing but Node's own modules.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCOPES = ['core', 'in-app-browser', 'locale'] as const;
export type Scope = (typeof SCOPES)[number];

const HERE = dirname(fileURLToPath(import.meta.url));

/** The directive must be among a spec's first lines, before any code. */
const HEAD_LINES = 12;
const DIRECTIVE = /^\/\/ @e2e:\s*(.*?)\s*$/;

/** What each non-core scope exists to exercise, found in a spec's code. */
export const NEEDS: Record<Exclude<Scope, 'core'>, { pattern: RegExp; because: string }> = {
  'in-app-browser': {
    pattern: /userAgent|navigator\.share|\bFBAN\b|whatsapp-android|messenger-ios|\bwv\b/i,
    because: 'its code reads the user agent or the share sheet',
  },
  locale: {
    pattern: /OTHER_LOCALE|iphone-safari-en-au|\ben-AU\b/,
    because: 'its code names the second locale',
  },
};

export type SpecScope = {
  file: string;
  /** `null` when there is no directive. */
  scopes: Scope[] | null;
  /** What is wrong with the directive itself. */
  invalid: string | null;
};

/** `// @e2e: …` out of a spec's text. */
export function parseScopes(text: string): { scopes: Scope[] | null; invalid: string | null } {
  const head = text.split('\n').slice(0, HEAD_LINES);
  const found = head.map((line) => DIRECTIVE.exec(line)).filter((m) => m !== null);
  if (found.length === 0) return { scopes: null, invalid: null };
  if (found.length > 1) return { scopes: null, invalid: 'more than one `// @e2e:` line' };
  const words = (found[0]?.[1] ?? '')
    .split(',')
    .map((w) => w.trim())
    .filter((w) => w !== '');
  const unknown = words.filter((w) => !(SCOPES as readonly string[]).includes(w));
  if (words.length === 0) return { scopes: null, invalid: 'the `// @e2e:` line names no scope' };
  if (unknown.length > 0) {
    return {
      scopes: null,
      invalid: `unknown scope ${unknown.map((w) => `\`${w}\``).join(', ')} (one of ${SCOPES.join(', ')})`,
    };
  }
  if (words.includes('core') && words.length > 1) {
    return { scopes: null, invalid: '`core` stands alone: the other scopes add to it' };
  }
  return { scopes: words as Scope[], invalid: null };
}

export function readSpecs(dir: string = HERE): SpecScope[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.spec.ts'))
    .sort()
    .map((file) => ({ file, ...parseScopes(readFileSync(join(dir, file), 'utf8')) }));
}

/** A spec's code without its comments, so prose that says "in-app browser" is not a use of it. */
export function codeOf(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|\s)\/\/.*$/, '$1'))
    .join('\n');
}

/** The globs a project's `testMatch` takes for a scope. */
export function specsFor(scope: Exclude<Scope, 'core'>, dir: string = HERE): string[] {
  const specs = readSpecs(dir).filter((s) => s.scopes?.includes(scope));
  if (specs.length === 0) {
    throw new Error(
      `no live spec is tagged \`${scope}\`: the project that runs them would be empty`,
    );
  }
  return specs.map((s) => `**/${s.file}`);
}

/** Everything that should fail the build, as sentences. */
export function problems(dir: string = HERE): string[] {
  const out: string[] = [];
  for (const spec of readSpecs(dir)) {
    const where = `tests/e2e-live/${spec.file}`;
    if (spec.invalid) {
      out.push(`${where}: ${spec.invalid}`);
      continue;
    }
    if (spec.scopes === null) {
      out.push(
        `${where}: has no \`// @e2e:\` line. Say \`core\` (Chromium and WebKit only), or \`in-app-browser\` and/or \`locale\` if the journey depends on the app that opened the link or the browser's locale (tests/e2e-live/scopes.ts). A spec with no line would silently run in two of the five projects.`,
      );
      continue;
    }
    const code = codeOf(readFileSync(join(dir, spec.file), 'utf8'));
    for (const [scope, { pattern, because }] of Object.entries(NEEDS)) {
      if (!spec.scopes.includes(scope as Scope) && pattern.test(code)) {
        out.push(
          `${where}: is tagged \`${spec.scopes.join(', ')}\` but ${because}; add \`${scope}\` to its \`// @e2e:\` line, or take the use out`,
        );
      }
    }
  }
  return out;
}
