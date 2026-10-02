/** @jsxImportSource react */
import type { ReactNode } from 'react';

import { EN_EMAIL, type EmailCopy } from '../copy.ts';
import { dateSpan, hoursSpan } from '../format.ts';
import { planInviteLink, subscriberFooter } from '../links.ts';
import type { AskedAgainInput } from '../types.ts';
import { Layout } from './Layout.tsx';

export function askedAgainCopy(input: AskedAgainInput): EmailCopy {
  return EN_EMAIL.askedAgain({
    circleName: input.circleName,
    dates: dateSpan(input.windowStart, input.windowEnd),
    hours: hoursSpan(input.dailyStartMin, input.dailyEndMin),
  });
}

/**
 * "The plan changed, add your times again" (spec §5.3, ADR 0046): to somebody
 * whose answer an edit cleared. The button opens `/j/<code>`, the grid, where
 * the empty state explains itself (SUS-130).
 */
export function AskedAgain({ input }: { input: AskedAgainInput }): ReactNode {
  return (
    <Layout
      copy={askedAgainCopy(input)}
      buttonUrl={planInviteLink(input.origin, input.planCode)}
      footer={subscriberFooter(input)}
    />
  );
}
