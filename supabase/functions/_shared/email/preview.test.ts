import { describe, expect, it } from 'vitest';

import { SUNDAY_CREW } from './fixtures.ts';
import { render } from './render.tsx';
import { sendEmail } from './resend.ts';

/**
 * `pnpm email:preview` — every email, rendered against the Sunday Crew and
 * delivered to the local mail catcher, so they can be read in a mail client
 * rather than as HTML files (Mailpit also scores each one for client support
 * under "Checks").
 *
 * Skipped unless `EMAIL_PREVIEW_URL` names the catcher, which only that script
 * sets: `pnpm check` never sends anything, even to a local inbox.
 */
const target = process.env['EMAIL_PREVIEW_URL'];

describe.skipIf(target === undefined || target === '')('email preview', () => {
  it('delivers every kind to the local mail catcher', async () => {
    process.env['EMAIL_CAPTURE_URL'] = target;
    try {
      for (const input of Object.values(SUNDAY_CREW)) {
        const email = await render(input);
        const sent = await sendEmail(
          {
            to: 'priya@example.com',
            subject: email.subject,
            html: email.html,
            text: email.text,
            headers: email.headers,
            tags: { kind: input.kind },
          },
          { contactId: 'preview', requestId: 'email-preview' },
        );
        expect(sent.transport).toBe('capture');
      }
    } finally {
      delete process.env['EMAIL_CAPTURE_URL'];
    }
  });
});
