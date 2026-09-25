import { RecordNudgeRequest, type RecordNudgeResponse } from '@circles/contracts';
import { instant } from '@circles/domain';

import { jsonHandler } from '../_shared/http.ts';
import { recordNudge } from './record.ts';
import { callerStore } from './store.ts';

/**
 * A conversion prompt: may it be shown, and what was done with it
 * (spec §5.11, S2-07). The contract says what the two calls mean; `record.ts`
 * holds the decision, and `nudgeEligibility` in the domain the rules.
 *
 * Who is being asked comes from the verified identity, never the body: a
 * guest is anonymous, and anybody else has a saved place. The app tier is not
 * told apart here yet — an installed app never asks about an app prompt,
 * because the client's own pre-check skips them (Slice 3, SUS-60).
 *
 * The write announces itself: `nudge_states`' trigger emits
 * `growth.nudge_shown` on insert and `growth.nudge_answered` on an answer.
 * Nothing is logged about the moment beyond the kit's line, which names the
 * function and the outcome only.
 */
Deno.serve(
  jsonHandler({
    name: 'record-nudge',
    schema: RecordNudgeRequest,
    handle: async ({ body, actor, caller }): Promise<RecordNudgeResponse> =>
      await recordNudge(
        callerStore(caller, actor.userId),
        body,
        actor.isAnonymous ? 'guest' : 'saved',
        instant(Date.now()),
      ),
  }),
);
