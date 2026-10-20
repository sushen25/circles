/** @jsxImportSource react */
import type { ReactNode } from 'react';

import { EN_EMAIL, type EmailCopy } from '../copy.ts';
import { settingsLink, stopLink } from '../links.ts';
import type { FirstPlanQuietInput } from '../types.ts';
import { Layout } from './Layout.tsx';

export function firstPlanQuietCopy(input: FirstPlanQuietInput): EmailCopy {
  return EN_EMAIL.firstPlanQuiet({ circleName: input.circleName });
}

/**
 * The founder's one "want a hand?" letter (SUS-240, ADR 0085): two sentences
 * and a name, on the page's plain ground. No lockup, no button — the way to
 * answer it is to reply. A support letter under the organiser-letters consent,
 * so it carries the organiser stop link and says where the switch is, like the
 * other letters that switch covers (ADR 0029, ADR 0069).
 */
export function FirstPlanQuiet({ input }: { input: FirstPlanQuietInput }): ReactNode {
  return (
    <Layout
      variant="plain"
      copy={firstPlanQuietCopy(input)}
      buttonUrl={settingsLink(input.origin)}
      footer={{
        kind: 'reason',
        sentence: EN_EMAIL.footer.firstPlan(input.circleName),
        settingsUrl: settingsLink(input.origin),
        stop: { url: stopLink(input.origin, 'organiser', input.stopToken), family: 'organiser' },
      }}
    />
  );
}
