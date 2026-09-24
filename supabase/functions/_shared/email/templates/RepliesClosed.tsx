/** @jsxImportSource react */
import type { ReactNode } from 'react';

import { EN_EMAIL, type EmailCopy } from '../copy.ts';
import { planLink } from '../links.ts';
import type { RepliesClosedInput } from '../types.ts';
import { Layout } from './Layout.tsx';

export function repliesClosedCopy(input: RepliesClosedInput): EmailCopy {
  return EN_EMAIL.repliesClosed({ circleName: input.circleName });
}

/**
 * The deadline passed and nothing is locked in (spec §5.7's "one reminder at the
 * deadline"). Opens the DeadlinePassed screen through the plan link. No
 * artboard row exists for it; the wording is the screen's three choices.
 *
 * Outside the organiser-email switch (ADR 0029): the plan other people
 * answered is waiting on the organiser alone. So no settings link, and a
 * footer that says it comes anyway.
 */
export function RepliesClosed({ input }: { input: RepliesClosedInput }): ReactNode {
  return (
    <Layout
      copy={repliesClosedCopy(input)}
      buttonUrl={planLink(input.origin, input.planCode)}
      footer={{ kind: 'reason', sentence: EN_EMAIL.footer.repliesClosed(input.circleName) }}
    />
  );
}
