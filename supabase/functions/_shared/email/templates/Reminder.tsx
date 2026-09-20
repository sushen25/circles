/** @jsxImportSource react */
import type { ReactNode } from 'react';

import { EN_EMAIL, type EmailCopy } from '../copy.ts';
import { clockTime, todayOrTonight } from '../format.ts';
import { planLink, subscriberFooter } from '../links.ts';
import type { ReminderInput } from '../types.ts';
import { Layout } from './Layout.tsx';

export function reminderCopy(input: ReminderInput): EmailCopy {
  return EN_EMAIL.reminder({
    circleName: input.circleName,
    when: todayOrTonight(input.start, input.zone),
    time: clockTime(input.start, input.zone),
    placeName: input.placeName,
    goingCount: input.goingCount,
  });
}

/** "Reminder: Sunday Crew tonight, 6:30 pm" — one, two hours before, to those going. */
export function Reminder({ input }: { input: ReminderInput }): ReactNode {
  return (
    <Layout
      copy={reminderCopy(input)}
      buttonUrl={planLink(input.origin, input.planCode)}
      footer={subscriberFooter(input)}
    />
  );
}
