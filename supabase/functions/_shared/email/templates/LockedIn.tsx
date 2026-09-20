/** @jsxImportSource react */
import type { ReactNode } from 'react';

import { EN_EMAIL, type EmailCopy } from '../copy.ts';
import { longDate, shortDate, timeRange } from '../format.ts';
import { planLink, subscriberFooter } from '../links.ts';
import type { LockedInInput } from '../types.ts';
import { Layout } from './Layout.tsx';

export function lockedInCopy(input: LockedInInput): EmailCopy {
  return EN_EMAIL.lockedIn({
    circleName: input.circleName,
    shortDate: shortDate(input.start, input.zone),
    longDate: longDate(input.start, input.zone),
    time: timeRange(input.start, input.end, input.zone),
    placeName: input.placeName,
    note: input.note,
    organiserName: input.organiserName,
  });
}

/**
 * "Locked in: Sunday Crew, Thu 17 Sep" — the Emails artboard's middle card.
 *
 * The button says "Add to calendar" and opens the plan, where the calendar sheet
 * is: the `.ics` download needs a session (`generate-ics`), which a link in an
 * email cannot carry.
 */
export function LockedIn({ input }: { input: LockedInInput }): ReactNode {
  return (
    <Layout
      copy={lockedInCopy(input)}
      buttonUrl={planLink(input.origin, input.planCode)}
      footer={subscriberFooter(input)}
    />
  );
}
