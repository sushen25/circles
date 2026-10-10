import { brand } from '@circles/config';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { t } from '../../copy';
import { FeedbackLink } from './FeedbackLink';
import { feedbackMailto, feedbackSubject, type FeedbackScreen } from './feedback';

const mocks = vi.hoisted(() => ({ track: vi.fn(), open: vi.fn() }));
vi.mock('../../analytics/track', () => ({ track: mocks.track }));
vi.mock('./feedback', async (original) => ({
  ...(await original<typeof import('./feedback')>()),
  openFeedbackMail: mocks.open,
}));

const SCREENS: FeedbackScreen[] = ['sent', 'confirmed', 'circle_home'];
/** What a screen knows about the group and must never put in the mail. */
const PRIVATE = ['K7M2QX9A', 'f1b2c3d4-0000-4000-8000-000000000001', 'Sunday Crew', 'Nina'];

describe('the feedback mail', () => {
  it('goes to the support address', () => {
    for (const s of SCREENS) {
      expect(feedbackMailto(s, 'web').startsWith(`mailto:${brand.supportEmail}?`)).toBe(true);
    }
  });

  it('names the screen and the platform in the subject', () => {
    expect(feedbackSubject('confirmed', 'web')).toBe(`${brand.name} feedback · Confirmed · web`);
    expect(feedbackSubject('sent', 'ios')).toBe(`${brand.name} feedback · Sent · ios`);
    expect(feedbackSubject('circle_home', 'android')).toBe(
      `${brand.name} feedback · Circle home · android`,
    );
  });

  it('has a subject and nothing else: no body, no cc, no code, id or name', () => {
    for (const s of SCREENS) {
      const url = new URL(feedbackMailto(s, 'web'));
      expect([...url.searchParams.keys()]).toEqual(['subject']);
      const decoded = decodeURIComponent(url.href);
      for (const secret of PRIVATE) expect(decoded).not.toContain(secret);
      // The only inputs are the screen and the platform, so the subject is a
      // fixed set; anything else in it is a regression.
      expect(url.searchParams.get('subject')).toMatch(
        /^\S+ feedback · [A-Za-z ]+ · (web|ios|android)$/,
      );
    }
  });

  it('takes no argument that could carry a plan code, circle id or name', () => {
    expect(feedbackMailto.length).toBeLessThanOrEqual(2);
    expect(feedbackSubject.length).toBeLessThanOrEqual(2);
  });
});

describe('FeedbackLink', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(SCREENS)('on %s counts the tap by screen and opens the mail', (s) => {
    render(<FeedbackLink screen={s} />);
    fireEvent.click(screen.getByRole('button', { name: t('feedback', 'link') }));
    expect(mocks.track).toHaveBeenCalledWith('feedback_opened', { screen: s });
    expect(mocks.open).toHaveBeenCalledWith(feedbackMailto(s));
  });
});
