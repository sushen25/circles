/** @jsxImportSource react */
import { render as toHtml } from '@react-email/render';
import type { ReactNode } from 'react';

import type { EmailCopy } from './copy.ts';
import { subscriberFooter } from './links.ts';
import { AboutTime, aboutTimeCopy } from './templates/AboutTime.tsx';
import { Cancelled, cancelledCopy } from './templates/Cancelled.tsx';
import { Changed, changedCopy } from './templates/Changed.tsx';
import {
  DidItHappen,
  DidItHappenParticipant,
  didItHappenCopy,
  didItHappenParticipantCopy,
} from './templates/DidItHappen.tsx';
import { LockedIn, lockedInCopy } from './templates/LockedIn.tsx';
import { OptionsReady, optionsReadyCopy } from './templates/OptionsReady.tsx';
import { Reminder, reminderCopy } from './templates/Reminder.tsx';
import { RepliesClosed, repliesClosedCopy } from './templates/RepliesClosed.tsx';
import { VerifyEmail, verifyEmailCopy } from './templates/VerifyEmail.tsx';
import { type EmailInput, type EmailKind, type RenderedEmail, SUBSCRIBER_KINDS } from './types.ts';

/**
 * `render(input) → { subject, html, text, headers }` for every kind of email
 * the product sends (ADR 0008).
 *
 * The HTML and the plain-text alternative come from **one tree**: React Email
 * renders the element to HTML, and renders the same element again as text. A
 * text part written separately would be a second copy of every sentence, and
 * the one nobody looks at is the one that drifts.
 *
 * Pure: no network, no database, no clock. Tokens arrive already minted (see
 * `types.ts`), so a render can be snapshot-tested and a send can be retried
 * without minting twice.
 */

type Template<Input> = {
  /** The words, which the component renders and whose subject is the email's. */
  readonly copy: (input: Input) => EmailCopy;
  readonly Component: (props: { input: Input }) => ReactNode;
};

/** One entry per kind, so a kind with no template is a type error, not a silent skip. */
const TEMPLATES: { [K in EmailKind]: Template<Extract<EmailInput, { kind: K }>> } = {
  verify_email: { copy: verifyEmailCopy, Component: VerifyEmail },
  locked_in: { copy: lockedInCopy, Component: LockedIn },
  changed: { copy: changedCopy, Component: Changed },
  cancelled: { copy: cancelledCopy, Component: Cancelled },
  reminder: { copy: reminderCopy, Component: Reminder },
  did_it_happen_participant: {
    copy: didItHappenParticipantCopy,
    Component: DidItHappenParticipant,
  },
  options_ready: { copy: optionsReadyCopy, Component: OptionsReady },
  replies_closed: { copy: repliesClosedCopy, Component: RepliesClosed },
  did_it_happen: { copy: didItHappenCopy, Component: DidItHappen },
  about_time: { copy: aboutTimeCopy, Component: AboutTime },
};

/**
 * `List-Unsubscribe` on the plan-update kinds (RFC 2369), pointing at the same
 * `/e#<token>` page as the footer, so a mail client's own unsubscribe control
 * reaches the same place as the link.
 *
 * **No `List-Unsubscribe-Post`.** RFC 8058's one-click form has the mail
 * provider POST to the URL itself, which means the token would have to be in a
 * part of the URL a server receives — the path or the query — and so in the
 * request log of whatever serves it. ADR 0023 moved every emailed token out of
 * exactly there. The one-click form is required of bulk senders (5,000 a day
 * to Gmail); this is transactional mail to a handful of people per plan.
 */
function headersFor(input: EmailInput): Record<string, string> {
  if (!isSubscriberInput(input)) return {};
  return { 'List-Unsubscribe': `<${subscriberFooter(input).manageUrl}>` };
}

type SubscriberInput = Extract<EmailInput, { kind: (typeof SUBSCRIBER_KINDS)[number] }>;

function isSubscriberInput(input: EmailInput): input is SubscriberInput {
  return (SUBSCRIBER_KINDS as readonly EmailKind[]).includes(input.kind);
}

export async function render(input: EmailInput): Promise<RenderedEmail> {
  // The union is narrowed by the key; TypeScript cannot follow that through an
  // index, so the one cast is here rather than in every template.
  const template = TEMPLATES[input.kind] as Template<EmailInput>;
  const tree = <template.Component input={input} />;
  const [html, text] = await Promise.all([
    toHtml(tree),
    // A heading in capitals is a text email shouting the date. The HTML sets it
    // in the display face instead; the text keeps the words as written.
    toHtml(tree, {
      plainText: true,
      htmlToTextOptions: { selectors: [{ selector: 'h1', options: { uppercase: false } }] },
    }),
  ]);
  return { subject: template.copy(input).subject, html, text, headers: headersFor(input) };
}
