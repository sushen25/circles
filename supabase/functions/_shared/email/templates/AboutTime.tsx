/** @jsxImportSource react */
import type { ReactNode } from 'react';

import { EN_EMAIL, type EmailCopy } from '../copy.ts';
import { circleLink, settingsLink } from '../links.ts';
import type { AboutTimeInput } from '../types.ts';
import { Layout } from './Layout.tsx';

export function aboutTimeCopy(input: AboutTimeInput): EmailCopy {
  return EN_EMAIL.aboutTime({
    circleName: input.circleName,
    since: EN_EMAIL.since(input.weeksSince),
  });
}

/** The cadence nudge, to one person only (spec §5.8, the nudge policy). */
export function AboutTime({ input }: { input: AboutTimeInput }): ReactNode {
  return (
    <Layout
      copy={aboutTimeCopy(input)}
      buttonUrl={circleLink(input.origin, input.circleId)}
      footer={{
        kind: 'reason',
        sentence: EN_EMAIL.footer.nudge(input.circleName),
        settingsUrl: settingsLink(input.origin),
      }}
    />
  );
}
