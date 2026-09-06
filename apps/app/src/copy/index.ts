import { brand } from '@circles/config';

import { en } from './en';

/**
 * Every user-facing string comes through here. Components never hold a literal
 * — `no-literal-jsx-strings` fails the build for one (architecture §11).
 *
 * There is no i18n library yet, and deliberately so: one locale, one file, and
 * a substitution rule small enough to read. `en.ts` is keyed by screen so the
 * strings for a screen can be reviewed as a unit, which is how voice is
 * actually kept consistent.
 */
export { en } from './en';
export type { Copy, Screen } from './en';

type Screens = typeof en;

/** `copy.join.youre_invited` — the compiler knows every key that exists. */
export const copy = en;

/** Values always available, so no caller has to remember to pass the brand. */
function defaults(): Record<string, string> {
  return { brand: brand.name, domain: brand.domain, support: brand.supportEmail };
}

/**
 * Fill `{placeholders}` in a string.
 *
 * An unknown placeholder is left as-is rather than replaced with `undefined`:
 * a visible `{count}` on screen is a bug someone will report, where the word
 * "undefined" reads as a crash. Interpolation is positional only — no plurals,
 * no gender, no dates. Dates come from the domain, already formatted.
 */
export function fill(template: string, params: Record<string, string | number> = {}): string {
  const values = { ...defaults(), ...params };
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}

/**
 * `t('join', 'youre_invited')` — a screen and one of its keys, both checked.
 *
 * Two arguments rather than a dotted path because TypeScript can then offer the
 * keys for that screen and nothing else, and a renamed screen is a compile
 * error at every use.
 */
export function t<S extends keyof Screens, K extends keyof Screens[S]>(
  screen: S,
  key: K,
  params?: Record<string, string | number>,
): string {
  return fill(en[screen][key] as string, params);
}
