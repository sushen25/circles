import { NOTIFICATION_KINDS, QUIET_SENSITIVE_KINDS } from '@circles/domain';
import { describe, expect, it } from 'vitest';

import { EN_EMAIL } from './copy.ts';
import { CHANGED_PLACE, MEMBER_NAMES, ORIGIN, SUNDAY_CREW, fixtureToken } from './fixtures.ts';
import { EmailLinkError } from './links.ts';
import { render } from './render.tsx';
import { EMAIL_KINDS, type EmailKind, QUIET_KINDS, SUBSCRIBER_KINDS } from './types.ts';

/**
 * Every email the product can send, rendered against the Sunday Crew
 * (ADR 0008). The snapshots under `__snapshots__/` are the review surface: a
 * copy change is a diff there, and each `.html` opens in a browser as the email
 * would look.
 */

const ORGANISER_KINDS = EMAIL_KINDS.filter(
  (kind) =>
    kind !== 'verify_email' &&
    !(SUBSCRIBER_KINDS as readonly string[]).includes(kind) &&
    !(QUIET_KINDS as readonly string[]).includes(kind),
);

/** The organiser kinds whose footer says where their switch is (ADR 0029). */
const POINTS_AT_SETTINGS: readonly string[] = ['options_ready', 'did_it_happen', 'about_time'];

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
    // And the only ones that could say anything about a quiet ask are the two
    // addressed to its initiator alone (spec §8.2, ADR 0038).
    const quietEmailed = QUIET_SENSITIVE_KINDS.filter((kind) =>
      (EMAIL_KINDS as readonly string[]).includes(kind),
    );
    expect([...quietEmailed].sort()).toEqual([...QUIET_KINDS].sort());
    for (const kind of QUIET_KINDS) {
      expect(NOTIFICATION_KINDS.find((spec) => spec.kind === kind)?.audience).toBe(
        'quiet_initiator',
      );
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
      if (kind !== 'verify_email') expect(subject).toContain('Sunday Crew');
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

    it('says where to turn it off only when a switch in the app would, and carries no token', async () => {
      // ADR 0029. Options ready and did it happen: "Emails about plans you
      // organise". About time: "Nudges to plan the next one". Both are on
      // /settings/notifications. Replies closed is stopped by neither, so it
      // says it comes anyway rather than pointing at a switch that would lie.
      const email = await render(SUNDAY_CREW[kind]);
      const settings = `${ORIGIN}/settings/notifications`;
      const links = hrefs(email.html).filter((href) => href.includes('/settings/'));
      if (POINTS_AT_SETTINGS.includes(kind)) {
        expect(links).toEqual([settings]);
        expect(email.text).toContain(EN_EMAIL.footer.settingsLabel);
      } else {
        expect(links).toEqual([]);
        expect(email.text).toContain(EN_EMAIL.footer.repliesClosed('Sunday Crew'));
      }
    });
  });

  it('points at settings from every kind the organiser-email switch stops', () => {
    // The switch and the pointer are two halves of one promise; a kind added to
    // the switch without its footer is a letter that stops without saying how.
    for (const spec of NOTIFICATION_KINDS.filter((s) => s.organiserEmailSwitch)) {
      expect(POINTS_AT_SETTINGS).toContain(spec.kind);
    }
  });

  describe.each(QUIET_KINDS)('the quiet ask email %s', (kind) => {
    it('says why it came and that nobody else got it, with no stop link and no token', async () => {
      const email = await render(SUNDAY_CREW[kind]);
      expect(email.text).toContain(EN_EMAIL.footer.quiet('Sunday Crew'));
      expect(hrefs(email.html).some((href) => /\/[aev]#|\/settings\//.test(href))).toBe(false);
      expect(email.headers).toEqual({});
    });

    it('carries no count and no name, in its subject or its body', async () => {
      const email = await render(SUNDAY_CREW[kind]);
      // Links aside: a circle's id has digits and says nothing.
      for (const part of [email.subject, email.text.replace(/https?:\/\/\S+/g, '')]) {
        expect(part).not.toMatch(/\d/);
        for (const name of MEMBER_NAMES) expect(part).not.toMatch(new RegExp(`\\b${name}\\b`));
      }
    });
  });

  describe('the owner’s fallback', () => {
    it('is its own letter: nothing to organise yet, nobody named, no switch', async () => {
      const email = await render({ ...SUNDAY_CREW.replies_closed, toOwner: true });
      expect(email.subject).toBe('Sunday Crew: nobody has picked a time yet');
      expect(email.text).toContain(EN_EMAIL.footer.owner('Sunday Crew'));
      expect(email.text).not.toMatch(/organising|keen|asked/);
      for (const name of MEMBER_NAMES) expect(email.text).not.toMatch(new RegExp(`\\b${name}\\b`));
      await expect(`Subject: ${email.subject}\n\n${email.text}\n`).toMatchFileSnapshot(
        './__snapshots__/replies_closed_owner.txt',
      );
      await expect(email.html).toMatchFileSnapshot('./__snapshots__/replies_closed_owner.html');
    });
  });

  describe('the verification email', () => {
    it('is the button and nothing else: no footer links, no re-entry, no offers', async () => {
      const email = await render(SUNDAY_CREW.verify_email);
      expect(hrefs(email.html)).toEqual([`${ORIGIN}/v#${fixtureToken('verify')}`]);
      expect(email.text).not.toContain(EN_EMAIL.footer.stopPlan);
      expect(email.text).not.toContain(EN_EMAIL.footer.manage);
      expect(email.headers).toEqual({});
    });

    it('says nothing about the circle to an address nobody has proved yet (spec §5.8)', async () => {
      // Somebody can type anybody's address. Until they click, the recipient is
      // a stranger, and a circle's name is not theirs to be told.
      const email = await render(SUNDAY_CREW.verify_email);
      for (const part of [email.subject, email.text, email.html]) {
        expect(part).not.toContain('Sunday Crew');
        for (const name of MEMBER_NAMES) expect(part).not.toMatch(new RegExp(`\\b${name}\\b`));
      }
    });

    it('is one sentence and the button', async () => {
      const email = await render(SUNDAY_CREW.verify_email);
      const body = email.text.split('\n').filter((line) => line.trim() !== '');
      // The wordmark, the sentence, the button with its link.
      expect(body).toHaveLength(3);
      expect(body[1]?.match(/[.?!](\s|$)/g)).toHaveLength(1);
    });
  });

  describe('the morning after', () => {
    it('opens the question each letter asks, not the plan page', async () => {
      // S1-29. The plan page says the meetup's time has passed, which is no
      // answer to "did it happen?". The organiser's button goes to the outcome,
      // a subscriber's to their own attendance; both carry the code only.
      const organiser = await render(SUNDAY_CREW.did_it_happen);
      expect(hrefs(organiser.html)).toContain(`${ORIGIN}/p/pnemab/outcome`);
      const member = await render(SUNDAY_CREW.did_it_happen_participant);
      expect(hrefs(member.html)).toContain(`${ORIGIN}/p/pnemab/attendance`);
      for (const email of [organiser, member]) {
        expect(hrefs(email.html)).not.toContain(`${ORIGIN}/p/pnemab`);
      }
    });
  });

  describe('a changed email', () => {
    it('says the time is off when the plan went back to asking', async () => {
      const email = await render(SUNDAY_CREW.changed);
      expect(email.text).toContain("Thursday's catch-up is off");
      expect(email.text).toContain('Choose new times');
    });

    it('says the time stands and the place moved, for a place correction', async () => {
      const email = await render(CHANGED_PLACE);
      expect(email.subject).toBe('New place: Sunday Crew, Thu 17 Sep');
      expect(email.text).toContain('Same time, new place');
      expect(email.text).toContain('6:30–8:30 pm');
      expect(email.text).toContain('Northcote Social Club');
      expect(email.text).not.toMatch(/is off|new times/i);
      await expect(`Subject: ${email.subject}\n\n${email.text}\n`).toMatchFileSnapshot(
        './__snapshots__/changed_place.txt',
      );
      await expect(email.html).toMatchFileSnapshot('./__snapshots__/changed_place.html');
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

  describe('the about-time email', () => {
    // A weekly circle is asked five days after it met, which is no whole weeks
    // (review round 1): the letter said "a couple of weeks" for five days.
    it.each([
      [0, 'about a week'],
      [1, 'a couple of weeks'],
      [4, 'about a month'],
      [9, 'about 2 months'],
    ])('after %i whole weeks, says %s', async (weeksSince, words) => {
      const email = await render({ ...SUNDAY_CREW.about_time, weeksSince });
      expect(email.text).toContain(`It's been ${words} since`);
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
