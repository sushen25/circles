import { describe, expect, it, vi } from 'vitest';

import { planAccess } from './access';

/**
 * Whether a member the plan is not asking should be asked on arrival
 * (ADR 0022). The server judges the deadline, not the device.
 */

const plan = vi.fn();
const participant = vi.fn();

function chain(result: () => unknown) {
  const link = {
    select: () => link,
    eq: () => link,
    maybeSingle: async () => ({ data: result(), error: null }),
  };
  return link;
}

vi.mock('../auth/client', () => ({
  authClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'me' } } } }) },
    from: (table: string) => chain(table === 'plans' ? plan : participant),
  }),
}));

const CODE = 'pnsundaycr' as never;

describe('planAccess', () => {
  it('asks a member the plan is not asking, whatever the device clock says about the deadline', async () => {
    // A deadline an hour ago by this device's clock. A phone running fast would
    // otherwise decide the plan had closed and never ask, leaving the member
    // refused `not_a_participant` by a server that is still taking answers.
    plan.mockReturnValue({
      id: 'p1',
      circle_id: 'c1',
      state: 'collecting',
      revision: 1,
      response_deadline: new Date(Date.now() - 3_600_000).toISOString(),
    });
    participant.mockReturnValue(null);

    await expect(planAccess(CODE)).resolves.toMatchObject({
      membership: 'member',
      needsAsking: true,
    });
  });

  it('does not ask a member the plan is already asking', async () => {
    plan.mockReturnValue({ id: 'p1', circle_id: 'c1', state: 'ready', revision: 1 });
    participant.mockReturnValue({ user_id: 'me' });

    await expect(planAccess(CODE)).resolves.toMatchObject({ needsAsking: false });
  });

  it('does not ask anybody to join a plan that has stopped asking', async () => {
    plan.mockReturnValue({ id: 'p1', circle_id: 'c1', state: 'confirmed', revision: 1 });
    participant.mockReturnValue(null);

    await expect(planAccess(CODE)).resolves.toMatchObject({ needsAsking: false });
  });
});
