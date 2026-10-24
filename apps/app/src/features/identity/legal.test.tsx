import { brand } from '@circles/config';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { en } from '../../copy';
import { LegalScreen } from './LegalScreen';
import { MainScreen } from './MainScreen';
import { NameScreen } from './NameScreen';
import { PrivacyScreen } from './PrivacyScreen';

/**
 * SUS-102, restored by S4-05: the privacy words say only what the product does.
 * Delete my account, leave a circle and download my data exist, so the pages
 * say so; what they must not promise is what the product does not do, and every
 * period they name has to be one the database enforces, because that is the one
 * claim a reader cannot check for themselves.
 */
const NOT_YET = /no delete button|not in the app yet|sell or share|never sell or share/i;

const textOf = (kind: 'terms' | 'privacy') => {
  const { container, unmount } = render(<LegalScreen kind={kind} />);
  const text = container.textContent ?? '';
  unmount();
  return text;
};

describe('what the privacy pages promise', () => {
  it('/privacy names who runs it, the version and the support address', () => {
    const text = textOf('privacy');

    expect(text).not.toMatch(NOT_YET);
    expect(text).toContain(`is run by ${brand.operator}.`);
    expect(text).not.toContain('[OPERATOR NAME]');
    expect(text).toContain('In force from 21 October 2026.');
    expect(text).not.toContain('[EFFECTIVE DATE]');
    expect(text).toContain(`write to ${brand.supportEmail}`);
    expect(text).toContain('aged 18 and over');
  });

  it('/privacy lists what the code collects, including what the old page left out', () => {
    const text = textOf('privacy');

    for (const collected of [
      // The address a guest gives without signing in, and the record of asking.
      'If you join without signing in and ask for updates about a plan, the address you type',
      'which wording you agreed to',
      // Attendance, outcome reports, interest answers, notes and place names.
      'whether you went',
      'report of how it went',
      "who started it and each person's answer about whether they are keen are stored privately",
      'note or place name',
      // The analytics device id, hashed IPs, and the session's IP and browser.
      'a random id for your browser, kept in its local storage',
      'whether you used the calendar check',
      'which prompts you have seen',
      'leave a circle from its settings, which ends their access',
      'hashed form of your IP address',
      'IP address and browser details it started from',
    ]) {
      expect(text, collected).toContain(collected);
    }
  });

  it('/privacy names every processor, and a country only where the repository gives one', () => {
    const text = textOf('privacy');

    for (const processor of ['Supabase', 'Resend', 'Cloudflare Turnstile', 'Expo']) {
      expect(text, processor).toContain(processor);
    }
    expect(text).toContain(`mail sent to ${brand.supportEmail}`);
    // Singapore is the production database's region (docs/runbooks/environments.md).
    // Every other processor waits for somebody to confirm where it is.
    expect(text).toContain('Country: Singapore');
    expect(text.match(/\[CONFIRM COUNTRY\]/g)).toHaveLength(4);
    expect(text).not.toMatch(/Country: (?!Singapore|\[CONFIRM COUNTRY\])/);
  });

  it('/privacy says which email an account gets without opting in, and that guests get none unasked', () => {
    const text = textOf('privacy');

    expect(text).toContain('With an account, without opting in one by one');
    expect(text).toContain('a sign-in code');
    expect(text).toContain('an occasional nudge to plan the next one');
    expect(text).toContain('only if you ask for it for that plan');
  });

  it('/privacy names the routes that exist: access, correction, deletion, leaving and a complaint', () => {
    const text = textOf('privacy');

    // The labels are the account screen's own, so renaming one breaks this.
    expect(text).toContain(en.account.export_my_data);
    expect(text).toContain('delete your account from Account');
    expect(text).toContain('leave a circle from its settings');
    expect(text).toContain('change your name and time zone in Account');
    expect(text).toContain('30 days later we delete your profile');
    expect(text).toContain(`write to ${brand.supportEmail}`);
    expect(text).toContain('Office of the Australian Information Commissioner');
  });

  it('/privacy discloses the YouTube API use the API audit asks for, and links its terms', () => {
    const text = textOf('privacy');

    expect(text).toContain('YouTube API Services');
    expect(text).toContain('youtube.upload permission and no other');
    expect(text).toContain(
      `only to upload ${brand.name}'s own videos to ${brand.name}'s own channel`,
    );
    expect(text).toContain("does not access, collect, store or share any YouTube user's data");
    expect(text).toContain('never asks you to connect a YouTube or Google account');

    // Each address is a link, and the sentence's full stop is not part of it.
    render(<LegalScreen kind="privacy" />);
    for (const url of [
      'https://www.youtube.com/t/terms',
      'https://policies.google.com/privacy',
      'https://security.google.com/settings/security/permissions',
    ]) {
      expect(screen.getByRole('link', { name: url })).toBeVisible();
    }
  });

  it('/terms states who runs it, 18+, no ads, no selling data and the 12-month windows', () => {
    const text = textOf('terms');

    expect(text).not.toMatch(NOT_YET);
    expect(text).toContain(`is run by ${brand.operator}.`);
    expect(text).not.toContain('[OPERATOR NAME]');
    expect(text).toContain('In force from 21 October 2026.');
    expect(text).not.toContain('[EFFECTIVE DATE]');
    expect(text).toContain('18 and over');
    expect(text).toContain('No ads. We do not sell your data');
    expect(text).toContain('12 months while you are in an active circle');
  });

  it('/settings/privacy names the same controls and keeps no promise the page cannot', () => {
    const { container } = render(<PrivacyScreen />);
    const text = container.textContent ?? '';

    expect(text).not.toMatch(NOT_YET);
    expect(text).toContain('delete your account any time from Account');
    expect(text).toContain(`Write to ${brand.supportEmail}`);
    expect(screen.getByRole('link', { name: 'Read the full privacy page' })).toBeVisible();
  });
});

describe('where the pages are shown', () => {
  it('the guest join links terms and privacy, and says 18+', () => {
    render(<MainScreen invite={{ circleName: 'Sunday Crew', memberInitials: ['M'] }} />);

    expect(screen.getByText(/For people 18 and over/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'terms' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'privacy' })).toBeVisible();
  });

  it('the name step links terms and privacy, and says 18+', () => {
    render(<NameScreen circleName="Sunday Crew" />);

    expect(screen.getByText(/For people 18 and over/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'terms' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'privacy' })).toBeVisible();
  });
});
