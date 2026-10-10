import { brand } from '@circles/config';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Platform } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { t } from '../../copy';
import { FeedbackLink } from './FeedbackLink';
import type * as FeedbackModule from './feedback';
import { feedbackMailto, feedbackSubject, type FeedbackScreen } from './feedback';

const mocks = vi.hoisted(() => ({ track: vi.fn(), open: vi.fn(), copy: vi.fn() }));
vi.mock('../../platform/share', () => ({ copyText: mocks.copy }));
vi.mock('../../analytics/track', () => ({ track: mocks.track }));
vi.mock('./feedback', async () => ({
  ...(await vi.importActual<typeof FeedbackModule>('./feedback')),
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

  it('says nothing before the tap, then gives the address in plain text, once, in a live region', () => {
    render(<FeedbackLink screen="sent" />);
    expect(screen.queryByText(/No mail app/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy address' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: t('feedback', 'link') }));
    const line = screen.getByText(`No mail app? Write to ${brand.supportEmail}`);
    expect(line.closest('[aria-live="polite"]')).not.toBeNull();
    // The mail is still opened, and the tap is counted once.
    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(mocks.track).toHaveBeenCalledTimes(1);
    // The region was there before the line, so it is announced when it arrives.
    expect(document.querySelectorAll('[aria-live="polite"]').length).toBe(1);
  });

  it('shows nothing that identifies anyone: the line is the address and nothing else', () => {
    render(<FeedbackLink screen="confirmed" />);
    fireEvent.click(screen.getByRole('button', { name: t('feedback', 'link') }));
    const text = document.body.textContent ?? '';
    for (const secret of PRIVATE) expect(text).not.toContain(secret);
  });

  it('copies the address, and says so', async () => {
    mocks.copy.mockResolvedValue(true);
    render(<FeedbackLink screen="sent" />);
    fireEvent.click(screen.getByRole('button', { name: t('feedback', 'link') }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy address' }));
    });
    expect(mocks.copy).toHaveBeenCalledWith(brand.supportEmail);
    expect(screen.getByRole('button', { name: 'Address copied' })).toBeTruthy();
    expect(mocks.track).toHaveBeenCalledTimes(1);
  });

  it('on a phone offers no Copy pill, which could not say the clipboard changed', () => {
    const was = Platform.OS;
    Platform.OS = 'ios';
    try {
      render(<FeedbackLink screen="sent" />);
      fireEvent.click(screen.getByRole('button', { name: t('feedback', 'link') }));
      expect(screen.getByText(`No mail app? Write to ${brand.supportEmail}`)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Copy address' })).toBeNull();
    } finally {
      Platform.OS = was;
    }
  });
});
