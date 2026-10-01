/** @jsxImportSource react */
import { Body } from '@react-email/body';
import { Button } from '@react-email/button';
import { Container } from '@react-email/container';
import { Head } from '@react-email/head';
import { Heading } from '@react-email/heading';
import { Hr } from '@react-email/hr';
import { Html } from '@react-email/html';
import { Link } from '@react-email/link';
import { Preview } from '@react-email/preview';
import { Section } from '@react-email/section';
import { Text } from '@react-email/text';
import type { ReactNode } from 'react';

import { EN_EMAIL, type EmailCopy } from '../copy.ts';
import { displayFont, interfaceFont, palette } from '../theme.ts';

/**
 * The frame every email shares: the lockup on the warm ground, one white card,
 * the words, one button, whatever footer the kind needs, and "Sent by" under
 * the card.
 *
 * The lockup is a PNG on the app's own origin, at twice the size it is shown:
 * mail clients block SVG, and a logo from a third-party host would be a
 * tracking pixel. Its alt text is the product name, which is what the
 * plain-text part and a client with images off show instead. The origin is the
 * button's, because every button in every email is a link into the app.
 *
 * The locked-in email is `confirmed`: the confirmed screen's dark ground and
 * the lockup's peach variant (manifesto §5.1), with the card unchanged.
 *
 * One button, always. Every notification "deep-links to a decision" (spec §5.8)
 * and an email with two calls to action has not decided which one it is for.
 */

const text = {
  fontFamily: interfaceFont,
  fontSize: '16px',
  lineHeight: '24px',
  color: palette.ink,
  margin: '0 0 12px',
};

const small = {
  fontFamily: interfaceFont,
  fontSize: '13px',
  lineHeight: '19px',
  color: palette.ink2,
  margin: '0 0 8px',
};

const smallLink = { color: palette.ink2, textDecoration: 'underline' };

/** The links under a plan-update email. Both work with no sign-in (spec §5.8). */
export type SubscriberFooter = {
  readonly kind: 'subscriber';
  readonly circleName: string;
  readonly stopPlanUrl: string;
  readonly manageUrl: string;
  /** Absent for a saved-place identity, who signs in instead (`issueReentryToken`). */
  readonly reentryUrl?: string | undefined;
};

/**
 * A sentence saying why this arrived, and — where a switch in the app stops it
 * — a line saying where that switch is (ADR 0029). Not a subscription, so no
 * stop link and no token: the reader has an account and signs in.
 */
export type ReasonFooter = {
  readonly kind: 'reason';
  readonly sentence: string;
  readonly settingsUrl?: string | undefined;
};

export type Footer = SubscriberFooter | ReasonFooter | { readonly kind: 'none' };

export type LayoutProps = {
  readonly copy: EmailCopy;
  readonly buttonUrl: string;
  readonly footer: Footer;
  readonly variant?: 'standard' | 'confirmed' | undefined;
};

/** Shown at 140 × 40; the files are 280 × 80 (`pnpm gen:brand`). */
const LOCKUP = { width: 140, height: 40 } as const;

function lockupUrl(buttonUrl: string, confirmed: boolean): string {
  const file = confirmed ? 'wenna-lockup-dark-2x.png' : 'wenna-lockup-2x.png';
  return `${new URL(buttonUrl).origin}/brand/${file}`;
}

function FooterBlock({ footer }: { footer: Footer }): ReactNode {
  if (footer.kind === 'none') return null;
  if (footer.kind === 'reason') {
    return (
      <>
        <Hr style={{ borderColor: palette.line, margin: '20px 0 16px' }} />
        <Text style={small}>{footer.sentence}</Text>
        {footer.settingsUrl === undefined ? null : (
          <Text style={small}>
            {EN_EMAIL.footer.settingsLead}{' '}
            <Link href={footer.settingsUrl} style={smallLink}>
              {EN_EMAIL.footer.settingsLabel}
            </Link>
            .
          </Text>
        )}
      </>
    );
  }
  return (
    <>
      <Hr style={{ borderColor: palette.line, margin: '20px 0 16px' }} />
      {footer.reentryUrl === undefined ? null : (
        <Text style={small}>
          {EN_EMAIL.footer.reentry(footer.circleName)}{' '}
          <Link href={footer.reentryUrl} style={smallLink}>
            {EN_EMAIL.footer.reentryLabel}
          </Link>
        </Text>
      )}
      <Text style={small}>
        <Link href={footer.stopPlanUrl} style={smallLink}>
          {EN_EMAIL.footer.stopPlan}
        </Link>
        {' · '}
        <Link href={footer.manageUrl} style={smallLink}>
          {EN_EMAIL.footer.manage}
        </Link>
      </Text>
    </>
  );
}

export function Layout({ copy, buttonUrl, footer, variant = 'standard' }: LayoutProps): ReactNode {
  const confirmed = variant === 'confirmed';
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
      </Head>
      <Preview>{copy.preview}</Preview>
      <Body style={{ backgroundColor: confirmed ? palette.invert : palette.ground, margin: 0 }}>
        <Container style={{ maxWidth: '480px', margin: '0 auto', padding: '24px 16px' }}>
          <img
            src={lockupUrl(buttonUrl, confirmed)}
            width={LOCKUP.width}
            height={LOCKUP.height}
            alt={EN_EMAIL.footer.sender}
            style={{
              display: 'block',
              border: 0,
              margin: '0 0 16px',
              fontFamily: displayFont,
              fontSize: '22px',
              lineHeight: '28px',
              color: confirmed ? palette.invertInk2 : palette.ink,
            }}
          />
          <Section
            style={{
              backgroundColor: palette.surface,
              border: `1px solid ${palette.line}`,
              borderRadius: '16px',
              padding: '24px',
            }}
          >
            {copy.headline === undefined ? null : (
              <Heading
                as="h1"
                style={{
                  fontFamily: displayFont,
                  fontWeight: 400,
                  fontSize: '26px',
                  lineHeight: '30px',
                  color: palette.ink,
                  margin: '0 0 12px',
                }}
              >
                {copy.headline}
              </Heading>
            )}
            {copy.paragraphs.map((paragraph) => (
              <Text key={paragraph} style={text}>
                {paragraph}
              </Text>
            ))}
            <Button
              href={buttonUrl}
              style={{
                backgroundColor: palette.accent,
                color: palette.surface,
                fontFamily: interfaceFont,
                fontSize: '16px',
                fontWeight: 600,
                borderRadius: '12px',
                padding: '12px 20px',
                margin: '8px 0 4px',
                textDecoration: 'none',
              }}
            >
              {copy.button.label}
            </Button>
            <FooterBlock footer={footer} />
          </Section>
          <Text
            style={{
              ...small,
              color: confirmed ? palette.invertInk2 : palette.ink2,
              margin: '16px 0 0',
              textAlign: 'center',
            }}
          >
            {EN_EMAIL.footer.sentBy}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
