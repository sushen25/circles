import { instant } from '@circles/domain';
import { describe, expect, it, vi } from 'vitest';

import { arrivalFor } from './access';

/**
 * Where somebody lands after joining or rejoining — which has to be somewhere
 * the server will take their answer.
 */

const rows = vi.fn();
vi.mock('../auth/client', () => ({
  authClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ order: async () => ({ data: rows(), error: null }) }) }),
    }),
  }),
}));

const CIRCLE = '00000000-0000-4000-8000-000000000a01' as never;
const NOW = instant(Date.UTC(2026, 8, 15, 7, 0));

describe('arrivalFor', () => {
  it('does not send anybody to a plan whose replies have closed', () => {
    // Still `collecting` — a plan stays decidable after its deadline (§5.7) —
    // but `replace_response` refuses every answer from the deadline on. Sending
    // a new member there is sending them to a form that cannot be submitted.
    rows.mockReturnValue([
      { short_code: 'closedplan', state: 'collecting', response_deadline: '2026-09-15T06:00:00Z' },
    ]);

    return expect(arrivalFor(CIRCLE, NOW)).resolves.toEqual({ kind: 'circle', id: CIRCLE });
  });

  it('sends them to the newest plan that is still asking', () => {
    rows.mockReturnValue([
      { short_code: 'confirmedp', state: 'confirmed', response_deadline: '2026-09-20T06:00:00Z' },
      { short_code: 'openplanxx', state: 'ready', response_deadline: '2026-09-18T06:00:00Z' },
    ]);

    return expect(arrivalFor(CIRCLE, NOW)).resolves.toEqual({ kind: 'plan', code: 'openplanxx' });
  });
});
