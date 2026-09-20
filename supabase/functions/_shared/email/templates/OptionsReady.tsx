/** @jsxImportSource react */
import type { ReactNode } from 'react';

import { EN_EMAIL, type EmailCopy } from '../copy.ts';
import { countInWords, weekdayName } from '../format.ts';
import { planLink } from '../links.ts';
import type { OptionsReadyInput } from '../types.ts';
import { Layout } from './Layout.tsx';

export function optionsReadyCopy(input: OptionsReadyInput): EmailCopy {
  return EN_EMAIL.optionsReady({
    circleName: input.circleName,
    weekday: weekdayName(input.bestStart, input.zone),
    count: countInWords(input.availableCount),
  });
}

/** "Thursday looks good for five of you." — to the organiser, on quorum. */
export function OptionsReady({ input }: { input: OptionsReadyInput }): ReactNode {
  return (
    <Layout
      copy={optionsReadyCopy(input)}
      buttonUrl={planLink(input.origin, input.planCode)}
      footer={{ kind: 'reason', sentence: EN_EMAIL.footer.organiser(input.circleName) }}
    />
  );
}
