/**
 * `@circles/contracts` — the boundary layer.
 *
 * Every Edge Function request and response, every deep link, the analytics
 * catalogue and the generated database types. Imports `@circles/domain` for
 * shared types and nothing else from the workspace (architecture §7.2).
 */
import { PACKAGE_NAME as DOMAIN } from '@circles/domain';

export const PACKAGE_NAME = '@circles/contracts';

/** The only workspace package contracts is allowed to depend on. */
export const DEPENDS_ON = [DOMAIN] as const;

export * from './ids.js';
export * from './time.js';
export * from './analytics.js';
export * from './deeplinks.js';
export * from './functions/index.js';
export type { Database, Tables } from './db.generated.js';
