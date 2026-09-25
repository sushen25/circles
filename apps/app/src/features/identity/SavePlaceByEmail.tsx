import { useState } from 'react';

import {
  SavePlaceError,
  requestLinkCode,
  savePlace,
  submitLinkCode,
  type SaveMoment,
} from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { normaliseAddress } from '../../data/email';
import { authFailure } from './authFailure';
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
type Step =
  | { kind: 'email' }
  | {
      kind: 'code';
      address: string;
      route: Awaited<ReturnType<typeof requestLinkCode>>;
      /** When the newest code was sent: the resend wait and the ten minutes run from here. */
      sentAt: number;
    };

export type SavePlaceByEmailProps = {
  moment: SaveMoment;
  circleName: string | undefined;
  /** Saved. The session is now a saved place. */
  onSaved: (address: string) => void | Promise<void>;
  onNotNow: () => void;
  onBack: () => void;
};

function sendProblem(error: unknown): SaveAccessProblem & EnterCodeProblem {
  const failure = authFailure(error);
  return failure === 'offline'
    ? 'offline'
    : failure === 'too_many'
      ? 'too_many_tries'
      : 'couldnt_send';
}

export function SavePlaceByEmail({
  moment,
  circleName,
  onSaved,
  onNotNow,
  onBack,
}: SavePlaceByEmailProps) {
  const live = hasBackend();
  const [step, setStep] = useState<Step>({ kind: 'email' });
  const [email, setEmail] = useState('');
  const [codeText, setCodeText] = useState('');
  const [busy, setBusy] = useState(false);
  const [emailProblem, setEmailProblem] = useState<SaveAccessProblem | undefined>();
  const [codeProblem, setCodeProblem] = useState<EnterCodeProblem | undefined>();
  const [reference, setReference] = useState<string | undefined>();
  const [newCodeSent, setNewCodeSent] = useState(false);

  if (step.kind === 'code') {
    const confirm = async () => {
      setBusy(true);
      setCodeProblem(undefined);
      setReference(undefined);
      try {
        await savePlace({
          moment,
          signIn: () => submitLinkCode(step.address, codeText, step.route),
        });
      } catch (error) {
        if (error instanceof SavePlaceError) {
          setCodeProblem('couldnt_save');
          setReference(error.problem?.reference);
        } else {
          const failure = authFailure(error);
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
        return;
      }
      await onSaved(step.address);
      setBusy(false);
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
          void requestLinkCode(step.address)
            .then((route) => {
              setStep({ ...step, route, sentAt: Date.now() });
              setNewCodeSent(true);
            })
            .catch((error: unknown) => setCodeProblem(sendProblem(error)));
        }}
        onBack={() => setStep({ kind: 'email' })}
      />
    );
  }

  return (
    <SaveAccessScreen
      circleName={circleName}
      email={email}
      problem={emailProblem}
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
        void requestLinkCode(address)
          .then((route) => setStep({ kind: 'code', address, route, sentAt: Date.now() }))
          .catch((error: unknown) => setEmailProblem(sendProblem(error)))
          .finally(() => setBusy(false));
      }}
      onNotNow={onNotNow}
      onBack={onBack}
    />
  );
}
