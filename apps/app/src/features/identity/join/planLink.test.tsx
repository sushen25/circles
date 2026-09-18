import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Arriving on a plan link, by who you are (ADR 0022, Decision 3).
 *
 * The decision is the guard's (`guards.test.ts` has every row); these are the
 * screens each row leads to, and what each one sends to `join-plan`.
 */

const replace = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn(), canGoBack: () => false }),
}));
const track = vi.fn();
vi.mock('../../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock('../../../data/auth/client', () => ({ hasBackend: () => true }));
vi.mock('../../../data/auth/guest', () => ({ ensureGuestSession: vi.fn(async () => ({})) }));

const session = { status: 'guest', userId: 'me', isAnonymous: true, isLoading: false };
vi.mock('../../../data/auth/session', () => ({
  useSession: () => session,
  sessionState: () => session,
  signOut: vi.fn(async () => undefined),
}));

const ownDisplayName = vi.fn();
vi.mock('../../../data/auth/profile', () => ({ ownDisplayName: () => ownDisplayName() }));

const joinPlan = vi.fn();
const guestMembersFor = vi.fn();
const planAccess = vi.fn();
const circleNameForCode = vi.fn();
vi.mock('../../../data/membership', () => ({
  planAccess: (...args: unknown[]) => planAccess(...args),
  circleNameForCode: (...args: unknown[]) => circleNameForCode(...args),
  guestMembersFor: (...args: unknown[]) => guestMembersFor(...args),
  joinPlan: (...args: unknown[]) => joinPlan(...args),
  reattachFromList: vi.fn(),
  circleAccess: vi.fn(),
  arrivalFor: vi.fn(),
  heldInvite: () => undefined,
  reattachWithToken: vi.fn(),
}));

const { MembershipGate } = await import('./MembershipGate');
const { FunctionError } = await import('../../../data/functions');

const CODE = 'pnsundaycr';
const CIRCLE_ID = '00000000-0000-4000-8000-000000000a01';
const ALEX = { circle_id: CIRCLE_ID, member_user_id: 'alex', display_name: 'Alex' };

function refusal(reason: string) {
  return new FunctionError(
    { error: 'conflict', reason, message: 'x', reference: 'R1' } as never,
    'x',
  );
}

function joined() {
  return {
    circle: { id: CIRCLE_ID, name: 'Sunday Crew' },
    member_user_id: 'me',
    plan_code: CODE,
  };
}

function arrive() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (children: ReactNode) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(
    tree(
      <MembershipGate target={{ kind: 'plan', code: CODE }}>
        <p>the plan</p>
      </MembershipGate>,
    ),
  );
}

async function type(name: string) {
  const input = await screen.findByLabelText('Your name');
  fireEvent.change(input, { target: { value: name } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  });
}

beforeEach(() => {
  Object.assign(session, { status: 'guest', userId: 'me', isAnonymous: true });
  for (const mock of [replace, track, ownDisplayName, joinPlan, guestMembersFor, planAccess]) {
    mock.mockReset();
  }
  planAccess.mockResolvedValue({ membership: 'not_member' });
  circleNameForCode.mockResolvedValue('Sunday Crew');
  guestMembersFor.mockResolvedValue({ kind: 'listed', members: [ALEX] });
});

describe('a guest, in a circle that has guests', () => {
  it('is asked which one they are, and "I\'m new here" asks for a name and joins', async () => {
    joinPlan.mockResolvedValue(joined());
    arrive();

    await screen.findByText('Welcome back. Which one is you?');
    fireEvent.click(screen.getByRole('button', { name: "I'm new here" }));
    await type('Ren');

    await waitFor(() => expect(joinPlan).toHaveBeenCalledTimes(1));
    expect(joinPlan.mock.calls[0]?.[0]).toMatchObject({ code: CODE, displayName: 'Ren' });
    expect(replace).toHaveBeenCalledWith({ pathname: '/j/[code]', params: { code: CODE } });
    // The circle and the door, and never the code (ADR 0022).
    expect(track).toHaveBeenCalledWith('circle_joined', {
      circle_id: CIRCLE_ID,
      source: 'plan_link',
    });
    expect(JSON.stringify(track.mock.calls)).not.toContain(CODE);
  });

  it('ends at the ask-for-the-invite state when the plan is not asking', async () => {
    // A quiet ask, a confirmed plan, a plan past its deadline and a code that
    // does not exist all answer the same `invite_inactive`, so this is the one
    // end state for all of them.
    joinPlan.mockRejectedValue(refusal('invite_inactive'));
    arrive();

    fireEvent.click(await screen.findByRole('button', { name: "I'm new here" }));
    await type('Ren');

    expect(await screen.findByText('You need the invite link to join.')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it('asks again for a taken name, and sends the new name under a new key', async () => {
    joinPlan.mockRejectedValueOnce(refusal('duplicate_name')).mockResolvedValue(joined());
    arrive();

    fireEvent.click(await screen.findByRole('button', { name: "I'm new here" }));
    await type('Alex');
    expect(await screen.findByText(/already called Alex/)).toBeTruthy();

    await type('Alex B');
    await waitFor(() => expect(joinPlan).toHaveBeenCalledTimes(2));
    const [first, second] = joinPlan.mock.calls.map(
      (call) => call[0] as { idempotencyKey: string },
    );
    // The same key for a different name would be `idempotency_mismatch`, and the
    // duplicate-name path could never be recovered from.
    expect(second?.idempotencyKey).not.toBe(first?.idempotencyKey);
  });
});

describe('a guest, in a circle with no guests', () => {
  it('never sees "Which one is you?": there is nobody to be', async () => {
    guestMembersFor.mockResolvedValue({ kind: 'listed', members: [] });
    joinPlan.mockResolvedValue(joined());
    arrive();

    await screen.findByText('What should the group call you?');
    expect(screen.queryByText('Welcome back. Which one is you?')).toBeNull();

    await type('Ren');
    await waitFor(() => expect(joinPlan).toHaveBeenCalledTimes(1));
  });
});

describe('an account that is not a member', () => {
  beforeEach(() => {
    Object.assign(session, { status: 'saved', userId: 'maya', isAnonymous: false });
  });

  it('sees one button naming the circle and themselves, never a list, and joins with no name', async () => {
    ownDisplayName.mockResolvedValue('Maya');
    joinPlan.mockResolvedValue(joined());
    arrive();

    const button = await screen.findByRole('button', { name: 'Join Sunday Crew as Maya' });
    expect(screen.queryByText('Welcome back. Which one is you?')).toBeNull();
    expect(guestMembersFor).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => expect(joinPlan).toHaveBeenCalledTimes(1));
    // No name: the server uses the profile's, and nothing here can rename it.
    expect(joinPlan.mock.calls[0]?.[0]).not.toHaveProperty('displayName');
    expect(replace).toHaveBeenCalledWith({ pathname: '/j/[code]', params: { code: CODE } });
  });

  it('is asked for a name for this circle only when their own is taken', async () => {
    ownDisplayName.mockResolvedValue('Maya');
    joinPlan.mockRejectedValueOnce(refusal('duplicate_name')).mockResolvedValue(joined());
    arrive();

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Join Sunday Crew as Maya' }));
    });

    expect(await screen.findByText(/already called Maya/)).toBeTruthy();
    expect(
      screen.getByText(
        'This is only what Sunday Crew will call you. Your account keeps its own name.',
      ),
    ).toBeTruthy();

    await type('Maya S');
    await waitFor(() => expect(joinPlan).toHaveBeenCalledTimes(2));
    expect(joinPlan.mock.calls[1]?.[0]).toMatchObject({ displayName: 'Maya S' });
  });

  it('is asked for a name rather than joining as the placeholder "Guest"', async () => {
    ownDisplayName.mockResolvedValue(null);
    arrive();

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Join Sunday Crew' }));
    });

    expect(await screen.findByText('What should the group call you?')).toBeTruthy();
    expect(joinPlan).not.toHaveBeenCalled();
  });

  it('says so when the circle is full, and stays', async () => {
    ownDisplayName.mockResolvedValue('Maya');
    joinPlan.mockRejectedValue(refusal('circle_full'));
    arrive();

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Join Sunday Crew as Maya' }));
    });

    expect(
      await screen.findByText(
        'Sunday Crew already has 20 people, which is as many as a circle holds.',
      ),
    ).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it('ends at the ask-for-the-invite state when the plan is not asking', async () => {
    ownDisplayName.mockResolvedValue('Maya');
    joinPlan.mockRejectedValue(refusal('invite_inactive'));
    arrive();

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Join Sunday Crew as Maya' }));
    });

    expect(await screen.findByText('You need the invite link to join.')).toBeTruthy();
  });
});

describe('a member', () => {
  it.each([
    ['a guest', 'guest'],
    ['an account', 'saved'],
  ])('%s goes straight to the plan', async (_who, status) => {
    Object.assign(session, { status });
    planAccess.mockResolvedValue({ membership: 'member' });
    arrive();

    expect(await screen.findByText('the plan')).toBeTruthy();
    expect(joinPlan).not.toHaveBeenCalled();
  });
});
