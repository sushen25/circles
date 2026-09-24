import { fromISO } from '@circles/domain';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  codeFor,
  readStackConfig,
  someone,
  type Stack,
} from '../../data/testing/stack.integration';
import { defaultDraft, resolveDraft, PRESETS } from './form';

/**
 * The acceptance criterion, both halves: **every preset produces the
 * documented deadline in the UI and on the server.** The setup card's
 * deadline is `resolveDraft`; the server's is `create-plan`'s. They are the
 * same domain rule run twice, a moment apart, so a default counted from "now"
 * may differ by the seconds between the two calls and by nothing else — and a
 * preset one refuses, the other refuses for the same reason.
 *
 * Needs `pnpm db:start`.
 */

let stack: Stack;
let owner: SupabaseClient;
let circleId: string;
const ZONE = 'Australia/Melbourne';

beforeAll(async () => {
  stack = readStackConfig();
  owner = createClient(stack.url, stack.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const address = someone('presets');
  expect((await owner.auth.signInWithOtp({ email: address })).error).toBeNull();
  const verified = await owner.auth.verifyOtp({
    email: address,
    token: await codeFor(stack.mailpit, address),
    type: 'email',
  });
  expect(verified.error).toBeNull();
  const circle = await owner.functions.invoke('create-circle', {
    body: {
      idempotency_key: globalThis.crypto.randomUUID(),
      name: 'Sunday Crew',
      color: 'sky',
      time_zone: ZONE,
      cadence: 'fortnightly',
    },
  });
  expect(circle.error).toBeNull();
  circleId = (circle.data as { circle: { id: string } }).circle.id;
});

/** Three days from today, two long: a custom window that is always ahead. */
function customDates(): { start: string; end: string } {
  const day = (offset: number) =>
    new Date(Date.now() + offset * 86_400_000).toLocaleDateString('en-CA', { timeZone: ZONE });
  return { start: day(3), end: day(4) };
}

describe('every preset, in the UI and on the server', () => {
  for (const preset of PRESETS) {
    it(`agrees on ${preset}`, async () => {
      const custom = preset === 'custom' ? customDates() : undefined;
      const draft = { ...defaultDraft({ duration: 120 }), preset, custom };
      const ui = resolveDraft(draft, fromISO(new Date().toISOString()), ZONE);

      const made = await owner.functions.invoke('create-plan', {
        body: {
          idempotency_key: globalThis.crypto.randomUUID(),
          circle_id: circleId,
          title: 'Catch up',
          preset,
          ...(custom === undefined ? {} : { custom }),
        },
      });

      if (!ui.ok) {
        // Tonight, late in the evening: both refuse, for the same reason.
        const body = await (made.error as { context?: Response }).context?.json();
        expect(body?.reason).toBe(ui.problem);
        return;
      }
      expect(made.error).toBeNull();
      const server = made.data as {
        response_deadline: string;
        window: { start: string; end: string };
      };
      expect(server.window).toEqual(ui.window);
      const drift = Date.parse(server.response_deadline) - Date.parse(ui.deadline);
      expect(drift).toBeGreaterThanOrEqual(0);
      expect(drift).toBeLessThan(30_000);
    });
  }
});
