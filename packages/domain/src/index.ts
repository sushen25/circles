/**
 * `@circles/domain` — the rules of the product, as pure TypeScript.
 *
 * Imported verbatim by the Expo app and by the Supabase Edge Functions
 * (ADR 0007), so it may import nothing but the standard library and
 * `date-fns-tz`: no React, no Supabase, no Deno APIs, no I/O. `pnpm lint`
 * enforces that, and enforces further that `date-fns-tz` appears only in
 * `shared/zone.ts`.
 *
 * Relative imports inside this package carry an explicit `.js` extension —
 * the built ESM output is loaded by Deno through an import map (S0-06).
 *
 * `shared/` holds the value objects every context is built from. The contexts
 * themselves — circles, planning, availability, scheduling, confirmation,
 * communication, growth — land in Slice 1.
 */
export const PACKAGE_NAME = '@circles/domain';

export * from './shared/instant.js';
export * from './shared/local-date.js';
export * from './shared/zone.js';
export * from './shared/interval.js';
export * from './shared/result.js';
export * from './shared/clock.js';
export * from './shared/events.js';
export * as fixtures from './shared/fixtures.js';
