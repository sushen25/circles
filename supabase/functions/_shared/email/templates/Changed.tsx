/** @jsxImportSource react */
import type { ReactNode } from 'react';

import { EN_EMAIL, type EmailCopy } from '../copy.ts';
import { shortDate, timeRange, weekdayName } from '../format.ts';
import { planLink, subscriberFooter } from '../links.ts';
import type { ChangedInput } from '../types.ts';
import { Layout } from './Layout.tsx';

export function changedCopy(input: ChangedInput): EmailCopy {
  if (input.change === 'place') {
    return EN_EMAIL.placeChanged({
      circleName: input.circleName,
      shortDate: shortDate(input.start, input.zone),
      weekday: weekdayName(input.start, input.zone),
      time: timeRange(input.start, input.end, input.zone),
      placeName: input.placeName,
    });
  }
  return EN_EMAIL.changed({
    circleName: input.circleName,
    shortDate: shortDate(input.previousStart, input.zone),
    weekday: weekdayName(input.previousStart, input.zone),
  });
}

/**
 * A material change (spec §5.8): the confirmed time is off and the circle is
 * finding another, or the time stands and the place moved. See `ChangedInput`.
 */
export function Changed({ input }: { input: ChangedInput }): ReactNode {
  return (
    <Layout
      copy={changedCopy(input)}
      buttonUrl={planLink(input.origin, input.planCode)}
      footer={subscriberFooter(input)}
    />
  );
}
