import { NOTIFICATION_KINDS, QUIET_SENSITIVE_KINDS } from '@circles/domain';
import { describe, expect, it } from 'vitest';

import { EN_EMAIL } from './copy.ts';
import { MEMBER_NAMES, ORIGIN, SUNDAY_CREW, fixtureToken } from './fixtures.ts';
import { EmailLinkError } from './links.ts';
import { render } from './render.tsx';
import { EMAIL_KINDS, type EmailKind, SUBSCRIBER_KINDS } from './types.ts';

/**
 * Every email the product can send, rendered against the Sunday Crew
 * (ADR 0008). The snapshots under `__snapshots__/` are the review surface: a
 * copy change is a diff there, and each `.html` opens in a browser as the email
 * would look.
 */

const ORGANISER_KINDS = EMAIL_KINDS.filter(
  (kind) => kind !== 'verify_email' && !(SUBSCRIBER_KINDS as readonly string[]).includes(kind),
);

/** Every `href` in the HTML, decoded. */
function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map(([, href]) =>
    (href ?? '').replace(/&amp;/g, '&'),
  );
}

describe('render', () => {
  it('covers exactly the kinds the domain sends by email', () => {
    const emailed = NOTIFICATION_KINDS.filter((spec) => spec.channels.includes('email')).map(
      (spec) => spec.kind,
    );
    expect([...EMAIL_KINDS].sort()).toEqual([...emailed].sort());
    // And none of them could say anything about a quiet ask (spec §8.2).
    for (const kind of QUIET_SENSITIVE_KINDS) {
      expect(EMAIL_KINDS as readonly string[]).not.toContain(kind);
    }
  });

  describe.each(EMAIL_KINDS)('%s', (kind: EmailKind) => {
    it('matches its snapshot', async () => {
      const email = await render(SUNDAY_CREW[kind]);
      await expect(`Subject: ${email.subject}\n\n${email.text}\n`).toMatchFileSnapshot(
        `./__snapshots__/${kind}.txt`,
      );
      await expect(email.html).toMatchFileSnapshot(`./__snapshots__/${kind}.html`);
    });

    it('names nobody but the circle in its subject', async () => {
      const { subject } = await render(SUNDAY_CREW[kind]);
      expect(subject).toContain('Sunday Crew');
      for (const name of MEMBER_NAMES) expect(subject).not.toMatch(new RegExp(`\\b${name}\\b`));
    });

    it('puts every token after the #, never in a path or a query', async () => {
      const email = await render(SUNDAY_CREW[kind]);
      const links = [...hrefs(email.html), ...Object.values(email.headers)];
      for (const link of links) {
        const [beforeHash] = link.split('#');
        for (const label of ['verify', 'prefs', 'reentry'] as const) {
          expect(beforeHash).not.toContain(fixtureToken(label));
        }
      }
    });

    it('sells nothing: no email mentions the app', async () => {
      const email = await render(SUNDAY_CREW[kind]);
      expect(`${email.subject}\n${email.text}`).not.toMatch(/\bapp\b|download|install/i);
    });
  });

  describe.each(SUBSCRIBER_KINDS)('the plan-update email %s', (kind) => {
    it('carries both footer links, each opening /e# with its own prefs token', async () => {
      const email = await render(SUNDAY_CREW[kind]);
      const prefs = `${ORIGIN}/e#${fixtureToken('prefs')}`;
      expect(email.text).toContain(EN_EMAIL.footer.stopPlan);
      expect(email.text).toContain(EN_EMAIL.footer.manage);
      expect(hrefs(email.html).filter((href) => href === prefs)).toHaveLength(2);
      expect(email.headers['List-Unsubscribe']).toBe(`<${prefs}>`);
    });

    it('carries the re-entry link for a guest, and leaves it out for a saved place', async () => {
      const guest = await render(SUNDAY_CREW[kind]);
      expect(hrefs(guest.html)).toContain(`${ORIGIN}/a#${fixtureToken('reentry')}`);

      const saved = await render({ ...SUNDAY_CREW[kind], reentryToken: null });
      expect(hrefs(saved.html).some((href) => href.includes('/a#'))).toBe(false);
      expect(saved.text).not.toContain(EN_EMAIL.footer.reentryLabel);
      // Everything else is the same letter.
      expect(saved.subject).toBe(guest.subject);
      expect(saved.text).toContain(EN_EMAIL.footer.stopPlan);
    });
  });

  describe.each(ORGANISER_KINDS)('the organiser email %s', (kind) => {
    it('says why it came, and offers no stop link that would not stop it', async () => {
      const email = await render(SUNDAY_CREW[kind]);
      expect(hrefs(email.html).some((href) => /\/[aev]#/.test(href))).toBe(false);
      expect(email.text).not.toContain(EN_EMAIL.footer.stopPlan);
      expect(email.headers).toEqual({});
    });
  });

  describe('the verification email', () => {
    it('is the button and nothing else: no footer links, no re-entry, no offers', async () => {
      const email = await render(SUNDAY_CREW.verify_email);
      expect(hrefs(email.html)).toEqual([`${ORIGIN}/v#${fixtureToken('verify')}`]);
      expect(email.text).not.toContain(EN_EMAIL.footer.stopPlan);
      expect(email.text).not.toContain(EN_EMAIL.footer.manage);
      expect(email.headers).toEqual({});
      expect(email.subject).toBe("Turn on updates for Sunday Crew's catch-up");
    });
  });

  describe('subjects, as the Emails artboard writes them', () => {
    it.each([
      ['locked_in', 'Locked in: Sunday Crew, Thu 17 Sep'],
      ['reminder', 'Reminder: Sunday Crew tonight, 6:30 pm'],
    ] as const)('%s', async (kind, subject) => {
      expect((await render(SUNDAY_CREW[kind])).subject).toBe(subject);
    });

    it('says "today" for a reminder before the evening', async () => {
      const brunch = { ...SUNDAY_CREW.reminder, start: SUNDAY_CREW.reminder.start - 8 * 3_600_000 };
      expect((await render(brunch as typeof SUNDAY_CREW.reminder)).subject).toBe(
        'Reminder: Sunday Crew today, 10:30 am',
      );
    });
  });

  describe('a link that cannot be built', () => {
    it('refuses a token that is not token-shaped, without quoting it', async () => {
      const secret = 'not a token';
      const failure = await render({ ...SUNDAY_CREW.locked_in, prefsToken: secret }).catch(
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(EmailLinkError);
      expect(String((failure as Error).message)).not.toContain(secret);
    });

    it('refuses an origin that is not a URL', async () => {
      await expect(render({ ...SUNDAY_CREW.verify_email, origin: 'not a url' })).rejects.toThrow(
        EmailLinkError,
      );
    });
  });
});
