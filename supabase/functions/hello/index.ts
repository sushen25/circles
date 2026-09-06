/**
 * Proves the shared-package import path works end to end, and nothing else.
 *
 * ADR 0007 rests on one claim: the same `packages/domain` runs on the client
 * and inside a Deno Edge Function, so the candidate engine and the plan rules
 * cannot drift between them. This function is where that claim is checked
 * before any feature depends on it — it imports the domain package through the
 * import map, and calls into `@circles/contracts` so that zod resolves from npm
 * in the same breath.
 *
 * It is a smoke test with a URL, not a product endpoint. Delete it the day a
 * real function covers the same ground.
 */
import { PACKAGE_NAME as DOMAIN } from '@circles/domain';
import { PACKAGE_NAME as CONTRACTS, validateEvent } from '@circles/contracts';

Deno.serve(() => {
  // Real work, not just a resolved import: this runs the catalogue's zod schema
  // inside Deno, which is the part most likely to break under bundling.
  const tracked = validateEvent('availability_submitted', { status: 'flexible' });

  return Response.json({
    domain: DOMAIN,
    contracts: CONTRACTS,
    // Proof that a schema from the shared package executed here.
    validated: tracked !== null,
    version: tracked?.version ?? null,
  });
});
