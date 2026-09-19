import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';

import { track } from '../../analytics/track';
import {
  SavePlaceError,
  bootstrapProfile,
  ownProfile,
  requestLinkCode,
  requestSignInCode,
  savePlace,
  submitLinkCode,
  submitSignInCode,
  safeReturnPath,
  useSession,
} from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import type { LinkRoute } from '../../data/auth/providers/email';
import { belongsToAnyCircle } from '../../data/circles';
import { normaliseAddress } from '../../data/email';
import { destinationAfterSignIn } from './afterSignIn';
import { authFailure } from './authFailure';
import {
  CODE_LIFETIME_MS,
  EnterCodeScreen,
  RESEND_AFTER_MS,
  type EnterCodeProblem,
} from './EnterCodeScreen';
import { SignInScreen, type SignInProblem } from './SignInScreen';

/**
 * `/sign-in` — the organiser's email path (spec §5.1 step 2), and where "I have
 * an account" on a plan link leads (ADR 0022).
 *
 * Two steps on one route, like saving a place: the address is personal data and
 * never goes in a URL, so it is held here rather than carried to a `/code`
 * route in a query string.
 *
 * **Which sign-in depends on who is here.**
 *
 * - Nobody, an account, or a guest who belongs to no circle: an ordinary
 *   sign-in (`signInWithOtp`). A guest with no memberships has nothing to lose
 *   by being replaced.
 * - A guest who belongs to a circle: **saving their place**, the same route
 *   SaveAccess takes, so their memberships come with them (`claim-identity`).
 *   An ordinary sign-in would replace the guest session and strand every
 *   membership it held, and a permanent identity can never reattach to them
 *   afterwards (`caller_is_permanent`).
 *
 * `returnTo` goes through `safeReturnPath` before anything reads it: a plan
 * link on this origin, or nothing — never a URL (an open redirect).
 */
type Step =
  | { kind: 'email' }
  | {
      kind: 'code';
      address: string;
      /** `sign_in`, or saving a guest's place by the route step one took. */
      via: { kind: 'sign_in' } | { kind: 'link'; route: LinkRoute };
      /** When the newest code was sent: the resend wait and the ten minutes run from here. */
      sentAt: number;
    };

export type SignInFlowProps = {
  /** The `next` query parameter, exactly as it arrived. Only a plan link survives. */
  returnTo?: string | string[] | undefined;
};

function emailProblem(error: unknown): SignInProblem {
  const failure = authFailure(error);
  return failure === 'offline'
    ? 'offline'
    : failure === 'too_many'
      ? 'too_many_tries'
      : 'couldnt_send';
}

export function SignInFlow({ returnTo }: SignInFlowProps) {
  const next = safeReturnPath(returnTo);
  const router = useRouter();
  const session = useSession();
  const live = hasBackend();

  const [step, setStep] = useState<Step>({ kind: 'email' });
  const [email, setEmail] = useState('');
  const [codeText, setCodeText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SignInProblem | undefined>();
  const [codeProblem, setCodeProblem] = useState<EnterCodeProblem | undefined>();
  const [reference, setReference] = useState<string | undefined>();
  const [newCodeSent, setNewCodeSent] = useState(false);
  const started = useRef(false);
  const sending = useRef(false);

  const back = () => (router.canGoBack() ? router.back() : router.replace(next ?? '/'));

  /** Asks for a code by whichever route this session needs. */
  const send = async (address: string): Promise<Step> => {
    const guestWithCircles = session.status === 'guest' && (await belongsToAnyCircle());
    if (guestWithCircles) {
      const route = await requestLinkCode(address);
      return { kind: 'code', address, via: { kind: 'link', route }, sentAt: Date.now() };
    }
    await requestSignInCode(address);
    return { kind: 'code', address, via: { kind: 'sign_in' }, sentAt: Date.now() };
  };

  if (step.kind === 'code') {
    const confirm = async () => {
      setBusy(true);
      setCodeProblem(undefined);
      setReference(undefined);
      try {
        if (step.via.kind === 'link') {
          const { route } = step.via;
          await savePlace({
            moment: 'settings',
            signIn: () => submitLinkCode(step.address, codeText, route),
          });
          track('account_claimed', { moment: 'settings' });
        } else {
          await submitSignInCode(step.address, codeText);
        }
      } catch (error) {
        if (error instanceof SavePlaceError) {
          setCodeProblem('couldnt_sign_in');
          setReference(error.problem?.reference);
        } else {
          const failure = authFailure(error);
          const expired = Date.now() - step.sentAt >= CODE_LIFETIME_MS;
          setCodeProblem(
            failure === 'offline'
              ? 'offline'
              : failure === 'too_many'
                ? 'too_many_tries'
                : failure === 'wrong_code'
                  ? expired
                    ? 'expired'
                    : 'wrong_code'
                  : 'couldnt_sign_in',
          );
        }
        setBusy(false);
        return;
      }

      // Signed in. Everything after this is finding the next screen, and a
      // failure here is not a failed sign-in: the Your name screen and the
      // circles list each read what they need again.
      let hasName = false;
      let hasCircles = false;
      try {
        const profile = await ownProfile();
        hasName = profile?.name !== null && profile?.name !== undefined;
        if (!hasName) {
          track('account_completed', { provider: 'email' });
          // A new account only: the device's zone into a profile still at the
          // trigger's `UTC`, for the plan-link path that never shows Your name.
          // A returning account's zone is theirs — `UTC` included, when that is
          // what they are in — and signing in on another device must not move
          // it (review round 1).
          await bootstrapProfile().catch(() => undefined);
        }
        if (next === undefined && hasName) hasCircles = await belongsToAnyCircle();
      } catch {
        // Unknown: Your name reads the profile again and says what it finds.
      }
      router.replace(destinationAfterSignIn({ next, hasName, hasCircles }));
    };

    return (
      <EnterCodeScreen
        address={step.address}
        code={codeText}
        problem={codeProblem}
        reference={reference}
        busy={busy}
        newCodeSent={newCodeSent}
        resendAt={step.sentAt + RESEND_AFTER_MS}
        onCodeChange={setCodeText}
        onContinue={() => void confirm()}
        onSendNewCode={() => {
          setCodeProblem(undefined);
          setNewCodeSent(false);
          void send(step.address)
            .then((sent) => {
              setStep(sent);
              setNewCodeSent(true);
            })
            .catch((error: unknown) => {
              const failure = authFailure(error);
              setCodeProblem(
                failure === 'offline'
                  ? 'offline'
                  : failure === 'too_many'
                    ? 'too_many_tries'
                    : 'couldnt_send',
              );
            });
        }}
        onBack={() => {
          setCodeText('');
          setCodeProblem(undefined);
          setStep({ kind: 'email' });
        }}
      />
    );
  }

  return (
    <SignInScreen
      email={email}
      problem={problem}
      busy={busy}
      returning={next !== undefined}
      onEmailChange={setEmail}
      onSendCode={() => {
        const address = normaliseAddress(email);
        if (address === null) {
          setProblem('not_an_address');
          return;
        }
        // No backend: the fixture journey has nowhere to send a code.
        if (!live) return;
        // One request at a time. The button is disabled while one is out, but
        // Enter in the field is not, and a second request invalidates the code
        // the first one mailed (review round 1).
        if (sending.current) return;
        sending.current = true;
        if (!started.current) {
          started.current = true;
          track('account_started', {});
        }
        setBusy(true);
        setProblem(undefined);
        void send(address)
          .then((sent) => {
            setCodeText('');
            setNewCodeSent(false);
            setStep(sent);
          })
          .catch((error: unknown) => setProblem(emailProblem(error)))
          .finally(() => {
            sending.current = false;
            setBusy(false);
          });
      }}
      onBack={back}
    />
  );
}
