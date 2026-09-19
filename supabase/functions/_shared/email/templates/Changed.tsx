/** @jsxImportSource react */
import type { ReactNode } from 'react';

import { EN_EMAIL, type EmailCopy } from '../copy.ts';
import { shortDate, weekdayName } from '../format.ts';
import { planLink, subscriberFooter } from '../links.ts';
import type { ChangedInput } from '../types.ts';
import { Layout } from './Layout.tsx';

export function changedCopy(input: ChangedInput): EmailCopy {
  return EN_EMAIL.changed({
    circleName: input.circleName,
    shortDate: shortDate(input.previousStart, input.zone),
    weekday: weekdayName(input.previousStart, input.zone),
  });
}

/** The confirmed time is off and the circle is finding another (spec §5.8: "materially changed"). */
export function Changed({ input }: { input: ChangedInput }): ReactNode {
  return (
    <Layout
      copy={changedCopy(input)}
      buttonUrl={planLink(input.origin, input.planCode)}
      footer={subscriberFooter(input)}
    />
  );
}
