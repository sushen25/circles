import { NOTIFICATION_SETTINGS_PATH } from '@circles/contracts';
import { isValidDisplayName, normaliseDisplayName } from '@circles/domain';
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
import { belongsToAnyCircle, newestCircleId } from '../../data/circles';
import { normaliseAddress } from '../../data/email';
import { Button, Tertiary } from '../../components';
import { t } from '../../copy';
import { finishProblem } from '../circles/finishDraft';
import { finishProblemWords, type FinishDraftProblem } from '../circles/FinishDraftScreen';
import { stepOf } from '../circles/FirstCircleScreen';
import { destinationAfterSignIn } from './afterSignIn';
import { authFailure, failureReference } from './authFailure';
import {
  CODE_LIFETIME_MS,
  EnterCodeScreen,
  RESEND_AFTER_MS,
  type EnterCodeProblem,
} from './EnterCodeScreen';
import { SignInScreen, type SignInProblem } from './SignInScreen';
import { WhosAskingScreen } from './WhosAskingScreen';

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

/** What the gate's `onPassed` made of the draft: where to go, or what to say and offer. */
export type GateOutcome =
  | { kind: 'go'; to: Parameters<ReturnType<typeof useRouter>['replace']>[0] }
  | { kind: 'problem'; problem: FinishDraftProblem; reference?: string | undefined };

export type SignInFlowProps = {
  /** The `next` query parameter, exactly as it arrived. Only a plan link survives. */
  returnTo?: string | string[] | undefined;
  /**
   * This is the organiser gate of the first run (ADR 0053, ADR 0090), not the
   * ordinary sign-in: screen 3 asks for a first name with the email, screen 4 is
   * the code, and the moment the code is through the name is saved and what was
   * drafted is made, inside that step. `onPassed` does the making and says where
   * to go; the circle's name is for the top bar and the status line.
   */
  gate?:
    { circle: string; onPassed: () => Promise<GateOutcome>; onBackToPlan: () => void } | undefined;
};

function emailProblem(failure: ReturnType<typeof authFailure>): SignInProblem {
  return failure === 'offline'
    ? 'offline'
    : failure === 'too_many'
      ? 'too_many_tries'
      : 'couldnt_send';
}

export function SignInFlow({ returnTo, gate }: SignInFlowProps) {
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
  // The gate's own: the first name, what is wrong with each field, the status
  // line under the code, and a failure after the code was accepted.
  const [firstName, setFirstName] = useState('');
  const [nameProblem, setNameProblem] = useState(false);
  const [emailField, setEmailField] = useState<'email_needed' | 'not_an_address' | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [setUp, setSetUp] = useState<
    { problem: FinishDraftProblem; reference: string | undefined } | undefined
  >();
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
    /** After the code: the name, then what was drafted. A failure here keeps the code step and says so. */
    const makeWhatWasDrafted = async () => {
      if (gate === undefined) return;
      setSetUp(undefined);
      setBusy(true);
      setStatus(t('firstRun', 'setting_up', { circle: gate.circle }));
      try {
        const profile = await ownProfile();
        if (profile?.name === null || profile?.name === undefined) {
          track('account_completed', { provider: 'email' });
          // The first name the gate asked for, and the device's zone, into a
          // profile still at the trigger's defaults: "Your name" is not asked
          // again, and a returning account's own name and zone are left alone.
          await bootstrapProfile({ name: normaliseDisplayName(firstName) });
        }
        const outcome = await gate.onPassed();
        if (outcome.kind === 'go') {
          router.replace(outcome.to);
          return;
        }
        setSetUp({ problem: outcome.problem, reference: outcome.reference });
      } catch (error) {
        const said = finishProblem(error);
        if (said.kind === 'saved_place') router.replace('/circles/new/plan');
        else setSetUp({ problem: said.problem, reference: said.reference });
      }
      setStatus(undefined);
      setBusy(false);
    };

    const confirm = async (code: string) => {
      setBusy(true);
      setCodeText(code);
      setCodeProblem(undefined);
      setReference(undefined);
      setStatus(t('enterCode', 'checking'));
      try {
        if (step.via.kind === 'link') {
          const { route } = step.via;
          const moment = gate === undefined ? 'settings' : 'organiser_gate';
          await savePlace({
            moment,
            signIn: () => submitLinkCode(step.address, code, route),
          });
          track('account_claimed', { moment });
        } else {
          await submitSignInCode(step.address, code);
        }
      } catch (error) {
        if (error instanceof SavePlaceError) {
          setCodeProblem('couldnt_sign_in');
          setReference(error.problem?.reference);
        } else {
          const failure = authFailure(error);
          setReference(failureReference(failure, error));
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
        setStatus(undefined);
        setBusy(false);
        return;
      }

      // The gate makes what was drafted here, in the code step (ADR 0090).
      if (gate !== undefined) {
        await makeWhatWasDrafted();
        return;
      }

      // Signed in. Everything after this is finding the next screen, and a
      // failure here is not a failed sign-in: the Your name screen and the
      // circles list each read what they need again.
      let hasName = false;
      let circleId: string | undefined;
      // A guest who saved their place is not a new account: the circle already
      // knows them by name (their membership's, not the profile's, which the
      // trigger left at `Guest`), so they are not asked again and not counted
      // as `account_completed` — `account_claimed` said what happened (review
      // round 4).
      const savedGuest = step.via.kind === 'link';
      try {
        const profile = await ownProfile();
        hasName = savedGuest || (profile?.name !== null && profile?.name !== undefined);
        if (!hasName) {
          track('account_completed', { provider: 'email' });
          // A new account only: the device's zone into a profile still at the
          // trigger's `UTC`, for the plan-link path that never shows Your name.
          // A returning account's zone is theirs — `UTC` included, when that is
          // what they are in — and signing in on another device must not move
          // it (review round 1).
          await bootstrapProfile().catch(() => undefined);
        }
        if (next === undefined && hasName) circleId = await newestCircleId();
      } catch {
        // Unknown: Your name reads the profile again and says what it finds.
      }
      router.replace(destinationAfterSignIn({ next, hasName, circleId }));
    };

    const timeWent = setUp?.problem === 'too_late' || setUp?.problem === 'time_passed';
    return (
      <EnterCodeScreen
        address={step.address}
        code={codeText}
        problem={codeProblem}
        reference={setUp === undefined ? reference : setUp.reference}
        busy={busy}
        status={status}
        newCodeSent={newCodeSent}
        resendAt={step.sentAt + RESEND_AFTER_MS}
        {...(gate === undefined ? {} : { title: gate.circle, step: stepOf(3, 3) })}
        notice={
          setUp === undefined || gate === undefined
            ? undefined
            : finishProblemWords(setUp.problem, gate.circle)
        }
        foot={
          setUp === undefined || gate === undefined ? undefined : (
            <>
              <Button
                label={t('finish', timeWent ? 'change_the_time' : 'try_again')}
                onPress={timeWent ? gate.onBackToPlan : () => void makeWhatWasDrafted()}
              />
              {timeWent ? null : (
                <Tertiary label={t('firstRun', 'back_to_the_plan')} onPress={gate.onBackToPlan} />
              )}
            </>
          )
        }
        onCodeChange={setCodeText}
        onContinue={(code) => void confirm(code)}
        onSendNewCode={() => {
          // One at a time, as on the first send: two taps must not mail two
          // codes, the second invalidating the first (review round 2).
          if (sending.current) return;
          sending.current = true;
          setCodeProblem(undefined);
          setReference(undefined);
          setNewCodeSent(false);
          void send(step.address)
            .then((sent) => {
              setStep(sent);
              setNewCodeSent(true);
            })
            .catch((error: unknown) => {
              const failure = authFailure(error);
              setReference(failureReference(failure, error));
              setCodeProblem(
                failure === 'offline'
                  ? 'offline'
                  : failure === 'too_many'
                    ? 'too_many_tries'
                    : 'couldnt_send',
              );
            })
            .finally(() => {
              sending.current = false;
            });
        }}
        onBack={() => {
          setCodeText('');
          setCodeProblem(undefined);
          setSetUp(undefined);
          setStatus(undefined);
          setStep({ kind: 'email' });
        }}
      />
    );
  }

  if (gate !== undefined) {
    return (
      <WhosAskingScreen
        circleName={gate.circle}
        name={firstName}
        email={email}
        nameProblem={nameProblem}
        emailProblem={emailField}
        problem={problem === 'not_an_address' ? undefined : problem}
        reference={reference}
        busy={busy}
        onNameChange={(text) => {
          setFirstName(text);
          setNameProblem(false);
        }}
        onEmailChange={(text) => {
          setEmail(text);
          setEmailField(undefined);
        }}
        onSendCode={(go) => {
          // What is wrong is said under the field, both at once, so a second
          // press is not a second surprise.
          const named = isValidDisplayName(firstName);
          const address = email.trim() === '' ? 'email_needed' : normaliseAddress(email);
          setNameProblem(!named);
          setEmailField(
            address === 'email_needed'
              ? 'email_needed'
              : address === null
                ? 'not_an_address'
                : undefined,
          );
          if (!named || address === null || address === 'email_needed') return;
          // No backend: the fixture journey has nowhere to send a code.
          if (!live) return;
          if (sending.current) return;
          sending.current = true;
          if (!started.current) {
            started.current = true;
            track('account_started', {});
          }
          setBusy(true);
          setProblem(undefined);
          setReference(undefined);
          void send(address)
            .then((sent) => {
              setCodeText('');
              setNewCodeSent(false);
              // Leaves this screen as it goes to the next: the code step is
              // its own mount, which arrives as a step does.
              go(() => setStep(sent));
            })
            .catch((error: unknown) => {
              const failure = authFailure(error);
              setProblem(emailProblem(failure));
              setReference(failureReference(failure, error));
            })
            .finally(() => {
              sending.current = false;
              setBusy(false);
            });
        }}
        onTerms={() => router.push('/terms')}
        onPrivacy={() => router.push('/privacy')}
        onBack={back}
      />
    );
  }

  return (
    <SignInScreen
      email={email}
      problem={problem}
      reference={reference}
      busy={busy}
      returning={next === NOTIFICATION_SETTINGS_PATH ? 'settings' : next !== undefined}
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
        setReference(undefined);
        void send(address)
          .then((sent) => {
            setCodeText('');
            setNewCodeSent(false);
            setStep(sent);
          })
          .catch((error: unknown) => {
            const failure = authFailure(error);
            setProblem(emailProblem(failure));
            setReference(failureReference(failure, error));
          })
          .finally(() => {
            sending.current = false;
            setBusy(false);
          });
      }}
      onBack={back}
    />
  );
}
