/**
 * `@circles/domain` — the rules of the product, as pure TypeScript.
 *
 * Imported verbatim by the Expo app and by the Supabase Edge Functions
 * (ADR 0007), so it may import nothing but the standard library and
 * `date-fns-tz`: no React, no Supabase, no Deno APIs, no I/O. `pnpm lint`
 * enforces that.
 *
 * Relative imports inside this package carry an explicit `.js` extension —
 * the built ESM output is loaded by Deno through an import map (S0-06).
 *
 * Contents land in S0-07 onwards (shared value objects, then one folder per
 * bounded context: circles, planning, availability, scheduling, confirmation,
 * communication, growth).
 */
export const PACKAGE_NAME = '@circles/domain';
