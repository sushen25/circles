import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The organiser's way in (S1-22): Welcome, the email, the code, Your name.
 * The auth server's own behaviour is the live suite's (`organiser.spec.ts`);
 * these pin what each screen sends and where it goes next.
 */

const push = vi.fn();
const replace = vi.fn();
/** Whether the screen under test is the one in front. */
const focus = { focused: true, epoch: 0 };
vi.mock('expo-router', async () => {
  const { useEffect } = await import('react');
  return {
    useRouter: () => ({ push, replace, back: vi.fn(), canGoBack: () => false }),
    useFocusEffect: (effect: () => void) => {
      const epoch = focus.epoch;
      useEffect(() => {
        if (focus.focused) return effect();
      }, [effect, epoch]);
    },
  };
});
const track = vi.fn();
vi.mock('../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));

const session = { status: 'none', userId: undefined as string | undefined, isLoading: false };
const auth = {
  requestSignInCode: vi.fn(),
  submitSignInCode: vi.fn(),
  requestLinkCode: vi.fn(),
  submitLinkCode: vi.fn(),
  savePlace: vi.fn(),
  bootstrapProfile: vi.fn(),
  ownProfile: vi.fn(),
  saveProfile: vi.fn(),
};
vi.mock('../../data/auth', async () => {
  const { safeReturnPath } = await import('../../data/auth/returnPath');
  const { guard } = await import('../../data/auth/guards');
  return {
    ...Object.fromEntries(
      Object.entries(auth).map(([name, fn]) => [name, (...a: unknown[]) => fn(...a)]),
    ),
    SavePlaceError: class extends Error {},
    deviceTimeZone: () => 'Australia/Melbourne',
    safeReturnPath,
    guard,
    useSession: () => session,
  };
});
vi.mock('../../data/auth/session', () => ({ useSession: () => session }));
const belongsToAnyCircle = vi.fn();
const newestCircleId = vi.fn();
vi.mock('../../data/circles', () => ({
  belongsToAnyCircle: () => belongsToAnyCircle(),
  newestCircleId: () => newestCircleId(),
}));

const { SignInFlow } = await import('./SignInFlow');
const { WelcomeFlow } = await import('./WelcomeFlow');
const { YourNameFlow } = await import('./YourNameFlow');

const ADDRESS = 'maya@example.com';

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

async function sendCodeTo(address: string) {
  fireEvent.change(await screen.findByLabelText('Your email'), { target: { value: address } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }));
  });
}

async function enter(code: string) {
  fireEvent.change(await screen.findByLabelText('Code'), { target: { value: code } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  });
}

beforeEach(() => {
  focus.focused = true;
  focus.epoch = 0;
  Object.assign(session, { status: 'none', userId: undefined, isLoading: false });
  for (const mock of [
    push,
    replace,
    track,
    belongsToAnyCircle,
    newestCircleId,
    ...Object.values(auth),
  ]) {
    mock.mockReset();
  }
  auth.requestSignInCode.mockResolvedValue(undefined);
  auth.submitSignInCode.mockResolvedValue({ session: {} });
  auth.bootstrapProfile.mockResolvedValue(undefined);
  auth.ownProfile.mockResolvedValue({ name: null, zone: null });
  belongsToAnyCircle.mockResolvedValue(false);
  newestCircleId.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Welcome', () => {
  it('offers email, and no button for a provider that is not built (SUS-77)', async () => {
    wrap(<WelcomeFlow />);
    expect(await screen.findByRole('button', { name: 'Continue with email' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Continue with Apple' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull();
  });

  it('links the terms and the privacy basics', async () => {
    wrap(<WelcomeFlow />);
    fireEvent.click(await screen.findByRole('link', { name: 'terms' }));
    fireEvent.click(screen.getByRole('link', { name: 'privacy' }));
    expect(push.mock.calls).toEqual([['/terms'], ['/privacy']]);
  });

  it('sends a returning account with a name and circles straight to them', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    auth.ownProfile.mockResolvedValue({ name: 'Maya', zone: 'Australia/Melbourne' });
    newestCircleId.mockResolvedValue('c1');
    wrap(<WelcomeFlow />);
    // Their circles list, which is live since S1-23.
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles'));
  });

  it('asks again each time it comes back into view, rather than reusing an old answer (review round 4)', async () => {
    // Signed in, sent to Your name, named, on to FirstCircle — then Back to
    // Welcome. The answer "/name" from before the name was saved must not be
    // the one it acts on.
    Object.assign(session, { status: 'saved', userId: 'maya' });
    auth.ownProfile.mockResolvedValue({ name: null, zone: null });
    const view = wrap(<WelcomeFlow />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/name'));

    replace.mockReset();
    auth.ownProfile.mockResolvedValue({ name: 'Maya', zone: 'Australia/Melbourne' });
    newestCircleId.mockResolvedValue('c1');
    focus.epoch += 1;
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <WelcomeFlow />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles'));
    expect(replace).not.toHaveBeenCalledWith('/name');
  });

  it('does not navigate from underneath the sign-in it sent somebody to', async () => {
    // Welcome stays mounted under `/sign-in`. When the sign-in there makes the
    // session a saved one, Welcome must not also send them somewhere: it
    // replaced the Your name screen the sign-in had just opened (found walking
    // the organiser flow on the live stack).
    focus.focused = false;
    Object.assign(session, { status: 'saved', userId: 'maya' });
    auth.ownProfile.mockResolvedValue({ name: null, zone: null });
    wrap(<WelcomeFlow />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('signing in by email', () => {
  it('refuses something that is not an address, and sends nothing', async () => {
    wrap(<SignInFlow />);
    await sendCodeTo('maya');
    expect(screen.getByText("That doesn't look like an email address.")).toBeVisible();
    expect(auth.requestSignInCode).not.toHaveBeenCalled();
  });

  it('asks for a code, and keeps the address out of every navigation', async () => {
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);

    expect(auth.requestSignInCode).toHaveBeenCalledWith(ADDRESS);
    expect(track).toHaveBeenCalledWith('account_started', {});
    expect(await screen.findByText(`Sent to ${ADDRESS}. It works for 10 minutes.`)).toBeVisible();
    expect(JSON.stringify([push.mock.calls, replace.mock.calls])).not.toContain(ADDRESS);
  });

  it('draws six boxes, keeps only digits, and takes a pasted code whole', async () => {
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);

    const field = await screen.findByLabelText('Code');
    fireEvent.change(field, { target: { value: '4 8-2 9x17 55' } });
    expect(field).toHaveValue('482917');
    expect(screen.getByRole('button', { name: 'Continue' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('waits thirty seconds before another code can be sent', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);

    const wait = await screen.findByRole('button', { name: /Send another in \d+s/ });
    fireEvent.click(wait);
    expect(auth.requestSignInCode).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(31_000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send a new code' }));
    });
    expect(auth.requestSignInCode).toHaveBeenCalledTimes(2);
  });

  it('says a code has expired after ten minutes, rather than that it is wrong', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    auth.submitSignInCode.mockRejectedValue({ code: 'otp_expired', status: 403 });
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);
    await act(async () => {
      vi.advanceTimersByTime(10 * 60_000 + 1);
    });
    await enter('123456');

    expect(await screen.findByText('That code has expired. Send a new one.')).toBeVisible();
  });

  it('sends a new account to Your name, counted as completed', async () => {
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);
    await enter('123456');

    expect(auth.submitSignInCode).toHaveBeenCalledWith(ADDRESS, '123456');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/name'));
    expect(track).toHaveBeenCalledWith('account_completed', { provider: 'email' });
  });

  it('skips Your name for a returning account with a name', async () => {
    auth.ownProfile.mockResolvedValue({ name: 'Maya', zone: 'Australia/Melbourne' });
    newestCircleId.mockResolvedValue('c1');
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);
    await enter('123456');

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles'));
    expect(track).not.toHaveBeenCalledWith('account_completed', expect.anything());
  });

  it("leaves a returning account's zone alone, UTC included (review round 1)", async () => {
    // `ownProfile` reads a stored `UTC` as "not chosen"; the bootstrap would
    // have replaced it with this device's zone on every sign-in.
    auth.ownProfile.mockResolvedValue({ name: 'Maya', zone: null });
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);
    await enter('123456');

    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(auth.bootstrapProfile).not.toHaveBeenCalled();
  });

  it("gives a new account the device's zone", async () => {
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);
    await enter('123456');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/name'));
    expect(auth.bootstrapProfile).toHaveBeenCalledTimes(1);
  });

  it('sends one new code however often Send a new code is tapped (review round 2)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);
    auth.requestSignInCode.mockImplementation(() => new Promise(() => undefined));
    await act(async () => {
      vi.advanceTimersByTime(31_000);
    });
    const resend = screen.getByRole('button', { name: 'Send a new code' });
    await act(async () => {
      fireEvent.click(resend);
      fireEvent.click(resend);
    });
    expect(auth.requestSignInCode).toHaveBeenCalledTimes(2);
  });

  it('sends one code however often Enter is pressed while it is on its way (review round 1)', async () => {
    auth.requestSignInCode.mockImplementation(() => new Promise(() => undefined));
    wrap(<SignInFlow />);
    const field = await screen.findByLabelText('Your email');
    fireEvent.change(field, { target: { value: ADDRESS } });
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter', code: 'Enter', keyCode: 13 });
      fireEvent.keyDown(field, { key: 'Enter', code: 'Enter', keyCode: 13 });
      fireEvent.click(screen.getByRole('button', { name: /Send me a code|Sending/ }));
    });
    expect(auth.requestSignInCode).toHaveBeenCalledTimes(1);
  });

  it('goes back to the plan link it was sent from', async () => {
    wrap(<SignInFlow returnTo="/p/abcdefgh" />);
    await sendCodeTo(ADDRESS);
    await enter('123456');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/p/abcdefgh'));
  });

  it('ignores a return path that would leave the site', async () => {
    wrap(<SignInFlow returnTo="https://elsewhere.example/j/abcdefgh" />);
    await sendCodeTo(ADDRESS);
    await enter('123456');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/name'));
    expect(JSON.stringify(replace.mock.calls)).not.toContain('elsewhere');
  });

  it('does not ask a guest who saved their place for a name, or count a new account (review round 4)', async () => {
    Object.assign(session, { status: 'guest', userId: 'priya' });
    belongsToAnyCircle.mockResolvedValue(true);
    newestCircleId.mockResolvedValue('c1');
    auth.requestLinkCode.mockResolvedValue('new_identity');
    auth.savePlace.mockResolvedValue({});
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);
    await enter('123456');

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles'));
    expect(track).not.toHaveBeenCalledWith('account_completed', expect.anything());
    expect(track).toHaveBeenCalledWith('account_claimed', { moment: 'settings' });
  });

  it("saves a guest's place rather than stranding their circles", async () => {
    Object.assign(session, { status: 'guest', userId: 'priya' });
    belongsToAnyCircle.mockResolvedValue(true);
    auth.requestLinkCode.mockResolvedValue('existing_account');
    auth.savePlace.mockResolvedValue({});
    wrap(<SignInFlow returnTo="/j/abcdefgh" />);
    await sendCodeTo(ADDRESS);
    await enter('123456');

    expect(auth.requestSignInCode).not.toHaveBeenCalled();
    expect(auth.requestLinkCode).toHaveBeenCalledWith(ADDRESS);
    expect(auth.savePlace).toHaveBeenCalledWith(expect.objectContaining({ moment: 'settings' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/j/abcdefgh'));
  });
});

describe('Your name', () => {
  beforeEach(() => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
  });

  it("saves the name with the device's zone, then goes to make a first circle", async () => {
    auth.saveProfile.mockResolvedValue(undefined);
    wrap(<YourNameFlow />);

    expect(await screen.findByText(/Melbourne.*from your phone/)).toBeVisible();
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: '  Maya ' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });

    expect(auth.saveProfile).toHaveBeenCalledWith({ name: 'Maya', zone: 'Australia/Melbourne' });
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles/new'));
  });

  it('lets the zone be changed to another, by city', async () => {
    auth.saveProfile.mockResolvedValue(undefined);
    wrap(<YourNameFlow />);

    fireEvent.click(await screen.findByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByLabelText('Search time zones'), { target: { value: 'london' } });
    fireEvent.click(screen.getByRole('radio', { name: 'London' }));
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Maya' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });

    expect(auth.saveProfile).toHaveBeenCalledWith({ name: 'Maya', zone: 'Europe/London' });
  });

  it('refuses an empty name before sending anything', async () => {
    wrap(<YourNameFlow />);
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    });
    expect(screen.getByText('Add a name of up to 40 characters.')).toBeVisible();
    expect(auth.saveProfile).not.toHaveBeenCalled();
  });

  it('sends somebody without a saved place back to Welcome', async () => {
    Object.assign(session, { status: 'guest', userId: 'priya' });
    wrap(<YourNameFlow />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
  });
});
