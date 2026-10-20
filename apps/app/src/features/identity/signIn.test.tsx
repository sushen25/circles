import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { tap } from '../../test/tap';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The organiser's way in (S1-22): the front door, the email, the code, Your name.
 * The auth server's own behaviour is the live suite's (`organiser.spec.ts`);
 * these pin what each screen sends and where it goes next.
 */

const push = vi.fn();
const replace = vi.fn();
const where = { pathname: '/' };
/** Whether the screen under test is the one in front. */
const focus = { focused: true, epoch: 0 };
vi.mock('expo-router', async () => {
  const { useEffect } = await import('react');
  return {
    useRouter: () => ({ push, replace, back: vi.fn(), canGoBack: () => false }),
    usePathname: () => where.pathname,
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

const askToShow = vi.fn();
const recordAnswer = vi.fn();
vi.mock('../../data/growth', () => ({
  askToShow: (...a: unknown[]) => askToShow(...a),
  recordAnswer: (...a: unknown[]) => recordAnswer(...a),
}));

const { brand } = await import('@circles/config');
const { resetClientErrors } = await import('../../analytics/clientError');
const { SignInFlow } = await import('./SignInFlow');
const { forgetSessionNudges } = await import('../growth/useNudge');
const { clearArrivalTag, keepArrivalTag } = await import('../../data/draft');
const { WelcomeFlow } = await import('./WelcomeFlow');
const { YourNameFlow } = await import('./YourNameFlow');

const ADDRESS = 'maya@example.com';
const QUESTION = `How did you hear about ${brand.name}?`;

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
  resetClientErrors();
  focus.focused = true;
  focus.epoch = 0;
  where.pathname = '/';
  Object.assign(session, { status: 'none', userId: undefined, isLoading: false });
  for (const mock of [
    push,
    replace,
    track,
    belongsToAnyCircle,
    newestCircleId,
    askToShow,
    recordAnswer,
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
  askToShow.mockResolvedValue({ suppressed: false });
  recordAnswer.mockResolvedValue(undefined);
  forgetSessionNudges();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the front door', () => {
  it('is the first circle with a quiet Sign in, and no sign-in before it (ADR 0053)', async () => {
    wrap(<WelcomeFlow />);
    expect(await screen.findByLabelText('Circle name')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Continue with email' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(push).toHaveBeenCalledWith('/sign-in');
  });

  it('sends a returning account with a name and circles straight to them', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    auth.ownProfile.mockResolvedValue({ name: 'Maya', zone: 'Australia/Melbourne' });
    newestCircleId.mockResolvedValue('c1');
    wrap(<WelcomeFlow />);
    // Their circles list, which is live since S1-23.
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles'));
  });

  it("sends a signed-in organiser from the website's Start a plan to a new circle, with no gate", async () => {
    where.pathname = '/start';
    Object.assign(session, { status: 'saved', userId: 'maya' });
    auth.ownProfile.mockResolvedValue({ name: 'Maya', zone: 'Australia/Melbourne' });
    newestCircleId.mockResolvedValue('c1');
    wrap(<WelcomeFlow />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles/new'));
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

describe('Save your place, the gate of the first run (ADR 0053)', () => {
  const place = {
    circle: 'Sunday Crew',
    kind: 'plan' as const,
    title: 'Catch up · next 14 days',
    detail: 'Evenings · about 2 hours',
  };

  it('says the plan is ready and summarises it, and links the terms', async () => {
    wrap(<SignInFlow gate={{ place, onPassed: async () => undefined }} />);
    expect(await screen.findByText("Your plan's ready. Save your place.")).toBeVisible();
    expect(screen.getByText('Catch up · next 14 days')).toBeVisible();
    fireEvent.click(screen.getByRole('link', { name: 'terms' }));
    fireEvent.click(screen.getByRole('link', { name: 'privacy' }));
    expect(push.mock.calls).toEqual([['/terms'], ['/privacy']]);
  });

  it('goes on to make the circle once the code is through, telling the draft first', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    // Asked before: the source question is the next describe's.
    askToShow.mockResolvedValue({ suppressed: true, reason: 'already_shown' });
    auth.ownProfile.mockResolvedValue({ name: 'Maya', zone: 'Australia/Melbourne' });
    const onPassed = vi.fn().mockResolvedValue(undefined);
    wrap(<SignInFlow gate={{ place, onPassed }} />);
    await sendCodeTo(ADDRESS);
    await enter('123456');

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles/new/finish'));
    expect(onPassed).toHaveBeenCalledTimes(1);
  });

  describe('"How did you hear about {brand}?" (SUS-171)', () => {
    const asked = () => askToShow.mock.calls.map(([target]) => target);
    const sourceEvents = () => track.mock.calls.filter(([name]) => name === 'organiser_source');

    async function throughTheCode() {
      Object.assign(session, { status: 'saved', userId: 'maya' });
      auth.ownProfile.mockResolvedValue({ name: 'Maya', zone: 'Australia/Melbourne' });
      const onPassed = vi.fn().mockResolvedValue(undefined);
      wrap(<SignInFlow gate={{ place, onPassed }} />);
      await sendCodeTo(ADDRESS);
      await enter('123456');
      return onPassed;
    }

    it('is asked once the code is through and before the circle is made, with one tap on each answer', async () => {
      const onPassed = await throughTheCode();
      expect(await screen.findByText(QUESTION)).toBeVisible();
      expect(replace).not.toHaveBeenCalled();
      expect(onPassed).toHaveBeenCalledTimes(1);
      expect(asked()).toEqual([{ moment: 'organiser_source', planId: undefined }]);
      for (const name of ["A friend's group", 'Reddit', 'A meetup or club', 'Somewhere else']) {
        expect(screen.getByRole('checkbox', { name })).toBeVisible();
      }
      expect(screen.getByRole('button', { name: 'Skip' })).toBeVisible();
      expect(screen.queryByRole('textbox')).toBeNull();

      fireEvent.click(screen.getByRole('checkbox', { name: 'Reddit' }));
      expect(replace).toHaveBeenCalledWith('/circles/new/finish');
      expect(sourceEvents()).toEqual([['organiser_source', { source: 'reddit' }]]);
      // The account's own record says it was answered, the same for every choice.
      expect(recordAnswer).toHaveBeenCalledTimes(1);
      expect(recordAnswer.mock.calls[0]?.[0]).toEqual({
        moment: 'organiser_source',
        planId: undefined,
      });
      expect(recordAnswer.mock.calls[0]?.[1]).toBe('tapped');
    });

    it('records a skip as skipped and goes straight on', async () => {
      await throughTheCode();
      await tap(screen.findByRole('button', { name: 'Skip' }));
      expect(replace).toHaveBeenCalledWith('/circles/new/finish');
      expect(sourceEvents()).toEqual([['organiser_source', { source: 'skipped' }]]);
      expect(recordAnswer.mock.calls[0]?.[1]).toBe('tapped');
    });

    it('goes on without the question when the server never answers, rather than waiting for ever', async () => {
      askToShow.mockReturnValue(new Promise(() => undefined));
      vi.useFakeTimers({ shouldAdvanceTime: true });
      await throughTheCode();
      expect(replace).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4100);
      });
      expect(replace).toHaveBeenCalledWith('/circles/new/finish');
      expect(sourceEvents()).toEqual([]);
    });

    it('is not asked again in this session by the same account at another gate', async () => {
      await throughTheCode();
      await tap(screen.findByRole('button', { name: 'Skip' }));
      cleanup();
      replace.mockReset();
      askToShow.mockClear();
      await throughTheCode();
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles/new/finish'));
      expect(screen.queryByText(QUESTION)).toBeNull();
      expect(sourceEvents()).toHaveLength(1);
    });

    it('counts a choice once, whatever else is tapped', async () => {
      await throughTheCode();
      const meetup = await screen.findByRole('checkbox', { name: 'A meetup or club' });
      fireEvent.click(meetup);
      fireEvent.click(meetup);
      fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
      expect(sourceEvents()).toHaveLength(1);
      expect(replace).toHaveBeenCalledTimes(1);
    });

    it('never shows an account that has been asked before, and counts nothing', async () => {
      askToShow.mockResolvedValue({ suppressed: true, reason: 'already_shown' });
      await throughTheCode();
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles/new/finish'));
      expect(screen.queryByText(QUESTION)).toBeNull();
      expect(sourceEvents()).toEqual([]);
    });

    it('does not block on a server that cannot be asked', async () => {
      askToShow.mockRejectedValue(new Error('offline'));
      await throughTheCode();
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles/new/finish'));
      expect(sourceEvents()).toEqual([]);
    });

    describe('arriving on a tagged link (SUS-240)', () => {
      beforeEach(() => clearArrivalTag());
      afterEach(() => clearArrivalTag());

      it('is not asked: the post is the answer, recorded as content, and counts as asked', async () => {
        await keepArrivalTag('tt-always-the-one-3');
        await throughTheCode();
        await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles/new/finish'));
        expect(screen.queryByText(QUESTION)).toBeNull();
        expect(sourceEvents()).toEqual([['organiser_source', { source: 'content' }]]);
        // The account's own record says the question was asked, as for any answer.
        expect(recordAnswer).toHaveBeenCalledTimes(1);
        expect(recordAnswer.mock.calls[0]?.[0]).toEqual({
          moment: 'organiser_source',
          planId: undefined,
        });
        expect(recordAnswer.mock.calls[0]?.[1]).toBe('tapped');
      });

      it('puts the tag itself in no event', async () => {
        await keepArrivalTag('tt-always-the-one-3');
        await throughTheCode();
        await waitFor(() => expect(replace).toHaveBeenCalled());
        expect(JSON.stringify(track.mock.calls)).not.toContain('tt-always-the-one-3');
        expect(JSON.stringify(recordAnswer.mock.calls)).not.toContain('tt-always-the-one-3');
      });

      it('records nothing for an account that was asked before, tag or not', async () => {
        await keepArrivalTag('tt-always-the-one-3');
        askToShow.mockResolvedValue({ suppressed: true, reason: 'already_shown' });
        await throughTheCode();
        await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles/new/finish'));
        expect(sourceEvents()).toEqual([]);
      });

      it('asks as today when the tag was malformed, because none was kept', async () => {
        await keepArrivalTag('Not A Slug!');
        await throughTheCode();
        expect(await screen.findByText(QUESTION)).toBeVisible();
        expect(sourceEvents()).toEqual([]);
      });
    });

    it('is not asked at the ordinary sign-in, where there is no gate', async () => {
      Object.assign(session, { status: 'saved', userId: 'maya' });
      auth.ownProfile.mockResolvedValue({ name: 'Maya', zone: 'Australia/Melbourne' });
      newestCircleId.mockResolvedValue('c1');
      wrap(<SignInFlow />);
      await sendCodeTo(ADDRESS);
      await enter('123456');
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles'));
      expect(askToShow).not.toHaveBeenCalled();
    });
  });

  it('asks a new account its name first', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    askToShow.mockResolvedValue({ suppressed: true, reason: 'already_shown' });
    wrap(<SignInFlow gate={{ place, onPassed: async () => undefined }} />);
    await sendCodeTo(ADDRESS);
    await enter('123456');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/name'));
  });

  it('is never what an ordinary sign-in does: a returning organiser is not handed a draft', async () => {
    auth.ownProfile.mockResolvedValue({ name: 'Maya', zone: 'Australia/Melbourne' });
    newestCircleId.mockResolvedValue('c1');
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);
    await enter('123456');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles'));
    expect(replace).not.toHaveBeenCalledWith('/circles/new/finish');
  });
});

/** auth-js's class for both a dropped connection (status 0) and a 5xx answer (its status). */
const authError = (status: number) =>
  Object.assign(new Error('x'), { name: 'AuthRetryableFetchError', status });

describe('"offline" only when the request never reached the server (SUS-200)', () => {
  it('says the code could not be sent, with a reference, and keeps the address, when the server answered 500', async () => {
    // The dev bug: POST /auth/v1/otp returned 500 and the screen blamed the connection.
    auth.requestSignInCode.mockRejectedValueOnce(authError(500));
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);

    expect(
      await screen.findByText("We couldn't send the code. Try again in a moment."),
    ).toBeVisible();
    expect(screen.queryByText(/offline/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Your email')).toHaveValue(ADDRESS);
    const [, payload] = track.mock.calls.find(([name]) => name === 'client_error')!;
    expect(payload).toMatchObject({ source: 'request_failed', route: '/' });
    expect(screen.getByText(`Ref ${(payload as { reference: string }).reference}`)).toBeVisible();
  });

  it('says "You\'re offline", with no reference and nothing reported, when the request never left', async () => {
    auth.requestSignInCode.mockRejectedValueOnce(authError(0));
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);

    expect(await screen.findByText("You're offline. Connect, then try again.")).toBeVisible();
    expect(screen.queryByText(/^Ref /)).not.toBeInTheDocument();
    expect(track.mock.calls.some(([name]) => name === 'client_error')).toBe(false);
    expect(screen.getByLabelText('Your email')).toHaveValue(ADDRESS);
  });

  it('puts the reference under a code that could not be checked, too', async () => {
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);
    auth.submitSignInCode.mockRejectedValueOnce(authError(503));
    await enter('123456');

    expect(await screen.findByText(/^Ref [2-9A-HJ-NP-Z]{8}$/)).toBeVisible();
    expect(screen.queryByText(/offline/)).not.toBeInTheDocument();
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

    expect(await screen.findByText(/^That code has expired\. Send a new one\./)).toBeVisible();
  });

  it('reads a deleted account as a wrong code, with the same words for any address', async () => {
    // Auth answers a banned user 403 `user_banned` for any code, so a message of
    // its own would tell anybody who knows an address that it was deleted. The
    // one screen says both, and names the reason for the person it is true of.
    auth.submitSignInCode.mockRejectedValue({ code: 'user_banned', status: 403 });
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);
    await enter('123456');

    expect(
      await screen.findByText(
        "That code didn't work. Check it, or send a new one. If you deleted your account, that address can't sign in again for 30 days.",
      ),
    ).toBeVisible();
  });

  it('empties the boxes after a wrong code and puts the cursor back in the first (SUS-204)', async () => {
    auth.submitSignInCode.mockRejectedValue({ code: 'otp_expired', status: 403 });
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);
    await enter('123456');

    expect(await screen.findByText(/That code didn't work/)).toBeVisible();
    const field = screen.getByLabelText('Code');
    await waitFor(() => expect(field).toHaveValue(''));
    expect(field).toHaveFocus();

    // And a second wrong code does it again.
    await enter('654321');
    await waitFor(() => expect(auth.submitSignInCode).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByLabelText('Code')).toHaveValue(''));
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

  it('lands an organiser from an email footer on notification settings, and says so (ADR 0029)', async () => {
    wrap(<SignInFlow returnTo="/settings/notifications" />);
    expect(
      screen.getByText("We'll bring you straight to your notification settings."),
    ).toBeVisible();
    expect(screen.queryByText(/back to the plan/)).toBeNull();
    await sendCodeTo(ADDRESS);
    await enter('123456');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/settings/notifications'));
  });

  it('ignores a return path that would leave the site', async () => {
    wrap(<SignInFlow returnTo="https://elsewhere.example/j/abcdefgh" />);
    await sendCodeTo(ADDRESS);
    await enter('123456');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/name'));
    expect(JSON.stringify(replace.mock.calls)).not.toContain('elsewhere');
  });

  it('does not ask a guest who saved their place for a name, or count a new account (review round 4)', async () => {
    Object.assign(session, { status: 'guest', userId: 'nina' });
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
    Object.assign(session, { status: 'guest', userId: 'nina' });
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

    await tap(screen.findByRole('button', { name: 'Change' }));
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
      await tap(screen.findByRole('button', { name: 'Continue' }));
    });
    expect(screen.getByText('Add a name of up to 40 characters.')).toBeVisible();
    expect(auth.saveProfile).not.toHaveBeenCalled();
  });

  it('sends somebody without a saved place back to Welcome', async () => {
    Object.assign(session, { status: 'guest', userId: 'nina' });
    wrap(<YourNameFlow />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
  });
});
