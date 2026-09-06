/**
 * `@circles/contracts` — the boundary layer: Zod schemas for every Edge
 * Function request/response, DTO and deep-link payload, the generated Supabase
 * types, and the typed analytics catalogue.
 *
 * Imports `@circles/domain` for shared types and nothing else from the
 * workspace (architecture §7.2). Contents land in S0-05.
 */
import { PACKAGE_NAME as DOMAIN } from '@circles/domain';

export const PACKAGE_NAME = '@circles/contracts';

/** The only workspace package contracts is allowed to depend on. */
export const DEPENDS_ON = [DOMAIN] as const;
