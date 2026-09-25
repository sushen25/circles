/** @jsxImportSource react */
import type { ReactNode } from 'react';

import { EN_EMAIL, type EmailCopy } from '../copy.ts';
import { circleLink, planLink } from '../links.ts';
import type { QuietExpiredInput, ThresholdInitiatorInput } from '../types.ts';
import { Layout } from './Layout.tsx';

/**
 * The quiet ask's two letters, both to its initiator alone, at their own
 * address (ADR 00XX). Neither names anybody or carries a count; neither has a
 * stop link, because neither is a subscription — each is sent once, about the
 * reader's own ask, and the footer says so.
 */

export function thresholdInitiatorCopy(input: ThresholdInitiatorInput): EmailCopy {
  return EN_EMAIL.thresholdInitiator({ circleName: input.circleName });
}

/** "Enough people are keen" (ThresholdRole): the plan, where the choice is offered. */
export function ThresholdInitiator({ input }: { input: ThresholdInitiatorInput }): ReactNode {
  return (
    <Layout
      copy={thresholdInitiatorCopy(input)}
      buttonUrl={planLink(input.origin, input.planCode)}
      footer={{ kind: 'reason', sentence: EN_EMAIL.footer.quiet(input.circleName) }}
    />
  );
}

export function quietExpiredCopy(input: QuietExpiredInput): EmailCopy {
  return EN_EMAIL.quietExpired({ circleName: input.circleName });
}

/** "Not enough people were free this time" (SparkExpired): back to circle home. */
export function QuietExpired({ input }: { input: QuietExpiredInput }): ReactNode {
  return (
    <Layout
      copy={quietExpiredCopy(input)}
      buttonUrl={circleLink(input.origin, input.circleId)}
      footer={{ kind: 'reason', sentence: EN_EMAIL.footer.quiet(input.circleName) }}
    />
  );
}
