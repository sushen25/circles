import { useRef, useState } from 'react';

import {
  SavePlaceError,
  requestLinkCode,
  savePlace,
  submitLinkCode,
  type SaveMoment,
} from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { normaliseAddress } from '../../data/email';
import { authFailure, failureReference } from './authFailure';
import {
  CODE_LIFETIME_MS,
  EnterCodeScreen,
  RESEND_AFTER_MS,
  type EnterCodeProblem,
} from './EnterCodeScreen';
import { SaveAccessScreen, type SaveAccessProblem } from './SaveAccessScreen';

/**
 * Saving a guest's place by email: an address, a code, then `savePlace`, which
 * links the anonymous identity (or signs into the account the address already
 * has) and reconciles memberships through `claim-identity` (spec §5.1, §10).
 *
 * One component for every door a guest saves their place through — Save
 * access on Sent (S1-30), "Keep your place for good?" after a Continue-as and
 * the organiser gate (S2-07) — so the two steps, their problems and the resend
 * wait exist once. Each door says only where it is (`moment`, which the
 * conversion funnel is measured by) and what happens after.
 *
 * The address is held here, in memory, and handed to `onSaved`; it is personal
 * data and never goes in a URL.
 */
type CodeStep = {
  kind: 'code';
  address: string;
  route: Awaited<ReturnType<typeof requestLinkCode>>;
  /** When the newest code was sent: the resend wait and the ten minutes run from here. */
  sentAt: number;
};
type Step = { kind: 'email' } | CodeStep;

/**
 * A code already asked for, by a door that has the address (the one-step card on
 * Sent, SUS-162): the flow opens on the code step, and Back leaves through
 * `onBack` rather than to an address the person has already given.
 */
export type CodeStart = Omit<CodeStep, 'kind'>;

export type SavePlaceByEmailProps = {
  moment: SaveMoment;
  circleName: string | undefined;
  /** Open on the code step: the code was asked for before this mounted. */
  start?: CodeStart | undefined;
  /** Saved. The session is now a saved place. */
  onSaved: (address: string) => void | Promise<void>;
  onNotNow: () => void;
  onBack: () => void;
};

function sendProblem(
  failure: ReturnType<typeof authFailure>,
): SaveAccessProblem & EnterCodeProblem {
  return failure === 'offline'
    ? 'offline'
    : failure === 'too_many'
      ? 'too_many_tries'
      : 'couldnt_send';
}

export function SavePlaceByEmail({
  moment,
  circleName,
  start,
  onSaved,
  onNotNow,
  onBack,
}: SavePlaceByEmailProps) {
  const live = hasBackend();
  const [step, setStep] = useState<Step>(
    start === undefined ? { kind: 'email' } : { kind: 'code', ...start },
  );
  const [email, setEmail] = useState('');
  const [codeText, setCodeText] = useState('');
  const [busy, setBusy] = useState(false);
  const [emailProblem, setEmailProblem] = useState<SaveAccessProblem | undefined>();
  const [codeProblem, setCodeProblem] = useState<EnterCodeProblem | undefined>();
  const [reference, setReference] = useState<string | undefined>();
  const [newCodeSent, setNewCodeSent] = useState(false);
  const confirming = useRef(false);

  if (step.kind === 'code') {
    const confirm = async (code: string) => {
      if (confirming.current) return;
      confirming.current = true;
      setBusy(true);
      setCodeProblem(undefined);
      setReference(undefined);
      try {
        await savePlace({
          moment,
          signIn: () => submitLinkCode(step.address, code, step.route),
        });
      } catch (error) {
        if (error instanceof SavePlaceError) {
          setCodeProblem('couldnt_save');
          setReference(error.problem?.reference);
        } else {
          const failure = authFailure(error);
          setReference(failureReference(failure, error));
          const expired = Date.now() - step.sentAt >= CODE_LIFETIME_MS;
          setCodeProblem(
            failure === 'offline'
              ? 'offline'
              : failure === 'wrong_code'
                ? expired
                  ? 'expired'
                  : 'wrong_code'
                : failure === 'too_many'
                  ? 'too_many_tries'
                  : 'couldnt_save',
          );
        }
        setBusy(false);
        confirming.current = false;
        return;
      }
      await onSaved(step.address);
      setBusy(false);
      confirming.current = false;
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
        onContinue={(code) => void confirm(code)}
        onSendNewCode={() => {
          setCodeProblem(undefined);
          setReference(undefined);
          void requestLinkCode(step.address)
            .then((route) => {
              setStep({ ...step, route, sentAt: Date.now() });
              setNewCodeSent(true);
            })
            .catch((error: unknown) => {
              const failure = authFailure(error);
              setReference(failureReference(failure, error));
              setCodeProblem(sendProblem(failure));
            });
        }}
        onBack={start === undefined ? () => setStep({ kind: 'email' }) : onBack}
      />
    );
  }

  return (
    <SaveAccessScreen
      circleName={circleName}
      email={email}
      problem={emailProblem}
      reference={reference}
      busy={busy}
      onEmailChange={setEmail}
      onSendCode={() => {
        const address = normaliseAddress(email);
        if (address === null) {
          setEmailProblem('not_an_address');
          return;
        }
        if (!live) return;
        setBusy(true);
        setEmailProblem(undefined);
        setReference(undefined);
        void requestLinkCode(address)
          .then((route) => setStep({ kind: 'code', address, route, sentAt: Date.now() }))
          .catch((error: unknown) => {
            const failure = authFailure(error);
            setReference(failureReference(failure, error));
            setEmailProblem(sendProblem(failure));
          })
          .finally(() => setBusy(false));
      }}
      onNotNow={onNotNow}
      onBack={onBack}
    />
  );
}
