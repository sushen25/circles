/** @jsxImportSource react */
import type { ReactNode } from 'react';

import { EN_EMAIL, type EmailCopy } from '../copy.ts';
import { verifyLink } from '../links.ts';
import type { VerifyEmailInput } from '../types.ts';
import { Layout } from './Layout.tsx';

export function verifyEmailCopy(_input: VerifyEmailInput): EmailCopy {
  return EN_EMAIL.verify();
}

/**
 * The only email somebody receives before they have agreed to receive email.
 *
 * So it carries one sentence and the button, and nothing else (spec §5.8: "the
 * verification email contains nothing but the link"). Not the circle's name:
 * the address may have been typed by somebody else. No footer links — there is no
 * subscription yet to stop, and a preferences token minted for an address that
 * has not proved itself would be a capability handed to whoever typed it — and
 * no re-entry link, which would be a way into a circle for an address nobody
 * has verified.
 */
export function VerifyEmail({ input }: { input: VerifyEmailInput }): ReactNode {
  return (
    <Layout
      copy={verifyEmailCopy(input)}
      buttonUrl={verifyLink(input.origin, input.verifyToken)}
      footer={{ kind: 'none' }}
    />
  );
}
