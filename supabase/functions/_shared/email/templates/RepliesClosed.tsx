/** @jsxImportSource react */
import type { ReactNode } from 'react';

import { EN_EMAIL, type EmailCopy } from '../copy.ts';
import { planLink, settingsLink, stopLink } from '../links.ts';
import type { RepliesClosedInput } from '../types.ts';
import { Layout } from './Layout.tsx';

export function repliesClosedCopy(input: RepliesClosedInput): EmailCopy {
  return input.toOwner === true
    ? EN_EMAIL.repliesClosedOwner({ circleName: input.circleName })
    : EN_EMAIL.repliesClosed({ circleName: input.circleName });
}

/**
 * The deadline passed and nothing is locked in (spec §5.7's "one reminder at the
 * deadline"). Opens the DeadlinePassed screen through the plan link. No
 * artboard row exists for it; the wording is the screen's three choices.
 *
 * Since ADR 0069 this is stoppable like the other organiser letters, by the
 * switch and by the stop link: ADR 0029 kept it outside the switch because a
 * plan other people answered waits on the organiser alone, and the founder
 * decided on 15 October 2026 that every account-holder letter can be stopped
 * from the letter. The footer says why it came, as the others do.
 */
export function RepliesClosed({ input }: { input: RepliesClosedInput }): ReactNode {
  return (
    <Layout
      copy={repliesClosedCopy(input)}
      buttonUrl={planLink(input.origin, input.planCode)}
      footer={{
        kind: 'reason',
        sentence:
          input.toOwner === true
            ? EN_EMAIL.footer.owner(input.circleName)
            : EN_EMAIL.footer.organiser(input.circleName),
        settingsUrl: settingsLink(input.origin),
        stop: { url: stopLink(input.origin, 'organiser', input.stopToken), family: 'organiser' },
      }}
    />
  );
}
