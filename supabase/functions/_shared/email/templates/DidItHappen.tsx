/** @jsxImportSource react */
import type { ReactNode } from 'react';

import { EN_EMAIL, type EmailCopy } from '../copy.ts';
import { weekdayName } from '../format.ts';
import { planLink, settingsLink, subscriberFooter } from '../links.ts';
import type { DidItHappenInput, DidItHappenParticipantInput } from '../types.ts';
import { Layout } from './Layout.tsx';

export function didItHappenCopy(input: DidItHappenInput): EmailCopy {
  return EN_EMAIL.didItHappen({
    circleName: input.circleName,
    weekday: weekdayName(input.start, input.zone),
  });
}

export function didItHappenParticipantCopy(input: DidItHappenParticipantInput): EmailCopy {
  return EN_EMAIL.didItHappenParticipant({
    circleName: input.circleName,
    weekday: weekdayName(input.start, input.zone),
  });
}

/**
 * "Did it happen?" in its two halves (SUS-22): the organiser's, which asks
 * whether the catch-up happened, and the subscriber's, which asks whether *they*
 * were there. Two kinds and two sentences, because the organiser's question put
 * to somebody who attended reads as though nobody told them.
 */
export function DidItHappen({ input }: { input: DidItHappenInput }): ReactNode {
  return (
    <Layout
      copy={didItHappenCopy(input)}
      buttonUrl={planLink(input.origin, input.planCode)}
      footer={{
        kind: 'reason',
        sentence: EN_EMAIL.footer.organiser(input.circleName),
        settingsUrl: settingsLink(input.origin),
      }}
    />
  );
}

export function DidItHappenParticipant({
  input,
}: {
  input: DidItHappenParticipantInput;
}): ReactNode {
  return (
    <Layout
      copy={didItHappenParticipantCopy(input)}
      buttonUrl={planLink(input.origin, input.planCode)}
      footer={subscriberFooter(input)}
    />
  );
}
