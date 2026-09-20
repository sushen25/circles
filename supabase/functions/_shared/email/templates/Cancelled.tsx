/** @jsxImportSource react */
import type { ReactNode } from 'react';

import { EN_EMAIL, type EmailCopy } from '../copy.ts';
import { weekdayName } from '../format.ts';
import { planLink, subscriberFooter } from '../links.ts';
import type { CancelledInput } from '../types.ts';
import { Layout } from './Layout.tsx';

export function cancelledCopy(input: CancelledInput): EmailCopy {
  return EN_EMAIL.cancelled({
    circleName: input.circleName,
    weekday: input.start === undefined ? undefined : weekdayName(input.start, input.zone),
    note: input.note,
    organiserName: input.organiserName,
  });
}

/** Called off, with the organiser's note when they left one (CancelPlan screen). */
export function Cancelled({ input }: { input: CancelledInput }): ReactNode {
  return (
    <Layout
      copy={cancelledCopy(input)}
      buttonUrl={planLink(input.origin, input.planCode)}
      footer={subscriberFooter(input)}
    />
  );
}
