/** @jsxImportSource react */
import type { ReactNode } from 'react';

import { EN_EMAIL, type EmailCopy } from '../copy.ts';
import { shortDate, timeRange } from '../format.ts';
import { planLink, subscriberFooter } from '../links.ts';
import type { MovedInput } from '../types.ts';
import { Layout } from './Layout.tsx';

export function movedCopy(input: MovedInput): EmailCopy {
  return EN_EMAIL.moved({
    circleName: input.circleName,
    shortDate: shortDate(input.start, input.zone),
    time: timeRange(input.start, input.end, input.zone),
    previousShortDate: shortDate(input.previousStart, input.zone),
    placeName: input.placeName,
    organiserName: input.organiserName,
  });
}

/**
 * "Change of plan: Sunday Crew is now Sat 19 Sep" (ADR 0050).
 *
 * On the confirmed ground, like the letter it follows (manifesto §5.1): the plan
 * still stands, it is somewhere else in the week. It asks nobody to do anything
 * about it, which is the whole difference from `Changed`.
 */
export function Moved({ input }: { input: MovedInput }): ReactNode {
  return (
    <Layout
      variant="confirmed"
      copy={movedCopy(input)}
      buttonUrl={planLink(input.origin, input.planCode)}
      footer={subscriberFooter(input)}
    />
  );
}
