/**
 * Every fixture builder, in one namespace: `fixtures.circle()`,
 * `fixtures.plan()`, `fixtures.window()`.
 *
 * Shared value-object builders live in `shared/fixtures.ts`; each bounded
 * context owns the builders for its own aggregates. This file is the only
 * place that knows both, which keeps `shared/` from importing a context.
 */
export * from './shared/fixtures.js';
export * from './circles/fixtures.js';
export * from './planning/fixtures.js';
export * from './availability/fixtures.js';
export * from './scheduling/fixtures.js';
export * from './confirmation/fixtures.js';
