import {
  FUNNEL,
  GATES,
  RATES,
  emptyFounderAnalytics,
  founderAnalyticsFixture,
} from '@circles/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { copy } from '../../copy';
import type * as FounderData from '../../data/founder';
import { NotFounderError } from '../../data/founder';

/**
 * The founder's analytics (SUS-166): the four sections from a fixture, each
 * state, and the allowlist's other side: anybody not on it, and anybody with no
 * saved place, gets the not-found screen and the question is never asked.
 */

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), canGoBack: () => false }),
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
const session: {
  status: string;
  userId: string | undefined;
  isAnonymous: boolean;
  isLoading: boolean;
} = { status: 'saved', userId: 'sam', isAnonymous: false, isLoading: false };
vi.mock('../../data/auth', () => ({ useSession: () => session }));

const fetchFounderAnalytics = vi.fn();
vi.mock('../../data/founder', async (original) => ({
  ...(await original<typeof FounderData>()),
  fetchFounderAnalytics: (...args: unknown[]) => fetchFounderAnalytics(...args),
}));

const track = vi.fn();
vi.mock('../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));

const { AnalyticsScreen } = await import('./AnalyticsScreen');
const { AnalyticsFlow } = await import('./AnalyticsFlow');

const NOT_FOUND = copy.notFound.title;

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

beforeEach(() => {
  session.status = 'saved';
  session.userId = 'sam';
  session.isLoading = false;
  fetchFounderAnalytics.mockReset();
  track.mockReset();
});

describe('the screen, from a fixture', () => {
  it('shows the north star with corroborated beside it', () => {
    render(<AnalyticsScreen data={founderAnalyticsFixture} />);
    expect(screen.getByText('North star')).toBeTruthy();
    expect(screen.getByText('Oct 2026')).toBeTruthy();
    // 5 reported over 4 activated circles.
    expect(screen.getByText('1.3')).toBeTruthy();
    expect(screen.getByText('Reported 5 · corroborated 3 · 4 activated circles')).toBeTruthy();
  });

  it('shows every gate with its target and value, founder cohort first', () => {
    render(<AnalyticsScreen data={founderAnalyticsFixture} />);
    expect(screen.getByText('Decision gates · founder cohort')).toBeTruthy();
    expect(screen.getByText('Decision gates · external cohort')).toBeTruthy();
    for (const gate of GATES) {
      const measure = (copy.founderAnalytics as Record<string, string>)[`gate_${gate.id}_measure`];
      expect(screen.getAllByText(measure ?? 'missing').length, gate.id).toBeGreaterThan(0);
    }
    expect(screen.getByText('Target at least 60%')).toBeTruthy();
    expect(screen.getByText('75% · 9 of 12')).toBeTruthy();
    expect(screen.getByText('1 m 40 s · 18 answers')).toBeTruthy();
  });

  it('says "Not measured" for a gate no view computes, and what is missing', () => {
    render(<AnalyticsScreen data={founderAnalyticsFixture} />);
    expect(screen.getAllByText('Not measured')).toHaveLength(2);
    expect(screen.getByText(/Missing: no price test or payment event exists yet/)).toBeTruthy();
    expect(
      screen.getByText(/Missing: the app opening is recorded without the moment/),
    ).toBeTruthy();
  });

  it('says a gate with too few answers has too few, and one met is met', () => {
    render(<AnalyticsScreen data={founderAnalyticsFixture} />);
    expect(screen.getAllByText('Too few to say').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Met').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Not met').length).toBeGreaterThan(0);
  });

  it('shows the funnel with the share of the step before', () => {
    render(<AnalyticsScreen data={founderAnalyticsFixture} />);
    expect(screen.getByText('Invitation')).toBeTruthy();
    expect(screen.getByText('29 · 71% of the step before')).toBeTruthy();
    expect(screen.getByText(/Not measured: whether the threshold was reached/)).toBeTruthy();
  });

  it('shows adoption with a boolean split and the named rate', () => {
    render(<AnalyticsScreen data={founderAnalyticsFixture} />);
    expect(screen.getByText('availability_started')).toBeTruthy();
    expect(screen.getByText('usual_offered · true')).toBeTruthy();
    expect(screen.getByText('usual_offered · false')).toBeTruthy();
    expect(screen.getByText('Previous times used when offered')).toBeTruthy();
    expect(screen.getByText('90% · 37 of 41')).toBeTruthy();
    // Every event is there: the ones with nothing are in one line.
    expect(screen.getByText(/plan_created/)).toBeTruthy();
  });

  it('shows no name, id or address anywhere', () => {
    const { container } = render(<AnalyticsScreen data={founderAnalyticsFixture} />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/Maya|Priya|Sunday/);
  });
});

describe('the other states', () => {
  it('is shaped like the screen while it loads', async () => {
    render(<AnalyticsScreen state="loading" />);
    await waitFor(() => expect(screen.getByText('Getting the numbers')).toBeTruthy());
  });

  it('says there are no events yet, for an empty database', () => {
    render(<AnalyticsScreen data={emptyFounderAnalytics} />);
    expect(screen.getByText('No events yet')).toBeTruthy();
    expect(screen.queryByText('Decision gates · founder cohort')).toBeNull();
  });

  it('gives an error a reference to read out, and a way to try again', () => {
    render(<AnalyticsScreen state="error" reference="K7QM2XAB" />);
    expect(screen.getByText("We couldn't load the numbers.")).toBeTruthy();
    expect(screen.getByText('Ref K7QM2XAB')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  it('says it is offline when it is', () => {
    render(<AnalyticsScreen state="offline" />);
    expect(screen.getByText("You're offline. Connect, then try again.")).toBeTruthy();
  });

  it('is the not-found screen for denied, and says nothing else', () => {
    const { container } = render(<AnalyticsScreen state="denied" data={founderAnalyticsFixture} />);
    expect(screen.getByText(NOT_FOUND)).toBeTruthy();
    expect(container.textContent).not.toMatch(/Analytics|founder|allowlist|not allowed/i);
  });
});

describe('who gets it', () => {
  it('shows the numbers to somebody on the allowlist, and records nothing', async () => {
    fetchFounderAnalytics.mockResolvedValue(founderAnalyticsFixture);
    wrap(<AnalyticsFlow />);
    await waitFor(() => expect(screen.getByText('North star')).toBeTruthy());
    expect(fetchFounderAnalytics).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
    expect(track).not.toHaveBeenCalled();
  });

  it('shows not-found to a user the database refuses', async () => {
    fetchFounderAnalytics.mockRejectedValue(new NotFounderError());
    wrap(<AnalyticsFlow />);
    await waitFor(() => expect(screen.getByText(NOT_FOUND)).toBeTruthy());
    expect(screen.queryByText('North star')).toBeNull();
    expect(track).not.toHaveBeenCalled();
  });

  it('shows not-found to a guest and to nobody without asking the database', async () => {
    for (const status of ['guest', 'none']) {
      session.status = status;
      const { unmount } = wrap(<AnalyticsFlow />);
      await waitFor(() => expect(screen.getByText(NOT_FOUND)).toBeTruthy());
      unmount();
    }
    expect(fetchFounderAnalytics).not.toHaveBeenCalled();
  });

  it('never shows one account the numbers it fetched for another', async () => {
    fetchFounderAnalytics.mockResolvedValue(founderAnalyticsFixture);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = () => (
      <QueryClientProvider client={client}>
        <AnalyticsFlow />
      </QueryClientProvider>
    );
    const { rerender } = render(tree());
    await waitFor(() => expect(screen.getByText('North star')).toBeTruthy());

    // Somebody else signs in on this tab, and their answer has not arrived.
    session.userId = 'outsider';
    fetchFounderAnalytics.mockReturnValue(new Promise(() => undefined));
    rerender(tree());
    await waitFor(() => expect(screen.queryByText('North star')).toBeNull());
  });

  it('waits for the session before it decides', () => {
    session.isLoading = true;
    wrap(<AnalyticsFlow />);
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(fetchFounderAnalytics).not.toHaveBeenCalled();
  });
});

describe('the words', () => {
  const words = copy.founderAnalytics as Record<string, string>;

  it('has a measure and a target for every gate, and a reason for every one nothing computes', () => {
    for (const gate of GATES) {
      expect(words[`gate_${gate.id}_measure`], gate.id).toBeTruthy();
      expect(words[`gate_${gate.id}_target`], gate.id).toBeTruthy();
      if (gate.measuredBy === null) expect(words[`gate_${gate.id}_missing`], gate.id).toBeTruthy();
    }
  });

  it('has a word for every funnel stage and step, and every rate', () => {
    for (const stage of FUNNEL) {
      expect(words[`stage_${stage.id}`], stage.id).toBeTruthy();
      if (stage.hasMissing === true)
        expect(words[`stage_${stage.id}_missing`], stage.id).toBeTruthy();
      for (const step of stage.steps) expect(words[`step_${step.id}`], step.id).toBeTruthy();
    }
    for (const rate of RATES) expect(words[`rate_${rate.id}`], rate.id).toBeTruthy();
  });
});
