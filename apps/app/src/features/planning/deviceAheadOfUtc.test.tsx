import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fromISO } from '@circles/domain';

import type * as CircleData from '../../data/circles';
import { dateWords } from '../availability/days';
import { defaultDraft, resolveDraft } from './form';

/**
 * A device a day ahead of UTC (SUS-137).
 *
 * Between Sydney midnight and 10:00 the device's date is the day after UTC's,
 * and a day after a circle's in the Americas. Three planning suites failed
 * there on a developer's machine and nowhere in CI, which runs on UTC. This
 * one holds the clock at 15:30 UTC on Friday 2 October (Saturday 3 October
 * 01:30 in Sydney, Friday 08:30 in Los Angeles) and moves the device across
 * the date line, so a day read from the device instead of the circle fails
 * here, in every zone the suite is run under.
 *
 * Node re-reads `TZ` on change, so the device is moved by setting it.
 */

const NOW = '2026-10-02T15:30:00.000Z';
const CIRCLE_ZONE = 'America/Los_Angeles';

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), canGoBack: () => true }),
  useIsFocused: () => true,
}));
vi.mock('../../analytics/track', () => ({ track: vi.fn() }));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
vi.mock('../../data/auth/session', () => ({
  useSession: () => ({ status: 'saved', userId: 'maya', isAnonymous: false, isLoading: false }),
}));
vi.mock('../../data/circles', async (original) => ({
  ...(await original<typeof CircleData>()),
  circleHome: async () => ({
    id: 'sunday-crew',
    name: 'Sunday Crew',
    zone: CIRCLE_ZONE,
    defaultDurationMinutes: 120,
    defaultQuorum: null,
    me: 'maya',
    isOwner: true,
    members: [
      { userId: 'maya', name: 'Maya' },
      { userId: 'nina', name: 'Nina' },
      { userId: 'tom', name: 'Tom' },
    ],
    activePlan: null,
  }),
}));
const { PlanSetupFlow } = await import('./PlanSetupFlow');

const home = process.env.TZ;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.useRealTimers();
  if (home === undefined) delete process.env.TZ;
  else process.env.TZ = home;
});

// Sydney is the zone the bug was found in; Kiritimati (UTC+14) is the furthest
// east a device can be, so the whole day-ahead window is as wide as it gets.
describe.each(['Australia/Sydney', 'Pacific/Kiritimati'])('a device in %s', (device) => {
  beforeEach(() => {
    process.env.TZ = device;
  });

  it('really is on the next day, so the rest of this file is meaningful', () => {
    expect(new Date().getDate()).toBe(3);
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-10-02');
  });

  it("reads today from the circle's clock: tonight in Los Angeles is Friday, not Saturday", () => {
    const answer = resolveDraft(
      { ...defaultDraft({ duration: 120 }), preset: 'tonight' },
      fromISO(NOW),
      CIRCLE_ZONE,
    );
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.window).toEqual({ start: '2026-10-02', end: '2026-10-02' });
  });

  it("writes a date in words as that date, never the device's neighbour of it", () => {
    expect(dateWords('2026-10-02' as never, 'short', 'en-US')).toBe('Fri Oct 2');
    expect(dateWords('2026-10-03' as never, 'short', 'en-US')).toBe('Sat Oct 3');
  });

  it("shows when replies close on the circle's clock, as the same screen does on UTC", async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <PlanSetupFlow id="sunday-crew" />
      </QueryClientProvider>,
    );
    // Three days on from 08:30 in Los Angeles, whatever day it is on the device.
    expect(await screen.findByText(/Mon Oct 5, 8:30 AM/)).toBeTruthy();
  });
});
