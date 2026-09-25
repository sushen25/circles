import { AcceptOrganiserRequest, type AcceptOrganiserResponse } from '@circles/contracts';

import { jsonHandler } from '../_shared/http.ts';
import { Refusal } from '../_shared/problem.ts';

/**
 * **I'll organise** / **I'll pick the time** on an opened quiet plan (spec
 * §5.4.5, architecture §9.1).
 *
 * As thin as `cancel-plan`, and for the same reason: every decision is
 * `public.accept_organiser`'s — whether this person may (keen, the initiator,
 * or the owner once replies close), that the first to accept wins, and what the
 * circle is told. **How they came to it is decided there and goes nowhere**:
 * not into the request, the response, an event or a log. The organiser's name
 * is public from this moment; `initiator` beside it would be the one thing a
 * quiet ask exists to keep (SUS-49).
 */
Deno.serve(
  jsonHandler({
    name: 'accept-organiser',
    schema: AcceptOrganiserRequest,
    guard: ({ actor }) => {
      // The database refuses this too; saying it first names the reason the
      // client needs to offer a saved place (ADR 0004), as `create-plan` does.
      if (actor.isAnonymous) {
        throw new Refusal('requires_saved_place', 'Save your place first, then take this on.');
      }
      return Promise.resolve();
    },
    handle: async ({ body, actor, caller }): Promise<AcceptOrganiserResponse> => {
      const { error } = await caller.rpc('accept_organiser', { p_plan_id: body.plan_id });
      if (error !== null) throw error;
      return {
        organiser_member_id: actor.userId as AcceptOrganiserResponse['organiser_member_id'],
      };
    },
  }),
);
