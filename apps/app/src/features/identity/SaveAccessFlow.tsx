import type { ShortCode } from '@circles/contracts';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { track } from '../../analytics/track';
import {
  SavePlaceError,
  requestLinkCode,
  savePlace,
  submitLinkCode,
  useSession,
} from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { noteSavedWith } from '../../data/auth/saved';
import { planToAnswer } from '../../data/availability';
import { normaliseAddress } from '../../data/email';
import { answerable } from '../../data/fixtures';
import {
  CODE_LIFETIME_MS,
  EnterCodeScreen,
  RESEND_AFTER_MS,
  type EnterCodeProblem,
} from './EnterCodeScreen';
import { SaveAccessScreen, type SaveAccessProblem } from './SaveAccessScreen';
import { authFailure } from './authFailure';

/**
 * `/j/:code/save-access` — keep your place on every device (spec §5.1, §5.11).
 *
 * An email code, then `savePlace`, which turns this guest into an account (or,
 * when the address already has one, signs into it) and reconciles memberships
 * through `claim-identity`. The moment is `after_answer`: that is where this
 * is offered. On success the person goes back where they came from and that
 * screen says so, once.
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

export function SaveAccessFlow({ code }: { code: string }) {
  const router = useRouter();
  const session = useSession();
  const live = hasBackend();
  const question = useQuery({
    queryKey: ['plan-to-answer', code, session.userId],
    queryFn: () => planToAnswer(code as ShortCode),
    enabled: live && session.userId !== undefined,
    staleTime: 30_000,
  });
  const circleName = live ? question.data?.plan.circleName : answerable.plan.circleName;

  const [step, setStep] = useState<Step>({ kind: 'email' });
  const [email, setEmail] = useState('');
  const [codeText, setCodeText] = useState('');
  const [busy, setBusy] = useState(false);
  const [emailProblem, setEmailProblem] = useState<SaveAccessProblem | undefined>();
  const [codeProblem, setCodeProblem] = useState<EnterCodeProblem | undefined>();
  const [reference, setReference] = useState<string | undefined>();
  const [newCodeSent, setNewCodeSent] = useState(false);
  // Read once: a successful save turns this session into a saved one, and the
  // screen should not flip to "already saved" underneath the person.
  const [alreadySaved] = useState(() => session.status === 'saved' || session.status === 'app');

  const back = () =>
    router.canGoBack()
      ? router.back()
      : router.replace({ pathname: '/j/[code]/sent', params: { code } });

  const askForCode = async (address: string): Promise<boolean> => {
    try {
      const route = await requestLinkCode(address);
      setStep({ kind: 'code', address, route, sentAt: Date.now() });
      return true;
    } catch (error) {
      const failure = authFailure(error);
      setEmailProblem(
        failure === 'offline'
          ? 'offline'
          : failure === 'too_many'
            ? 'too_many_tries'
            : 'couldnt_send',
      );
      return false;
    }
  };

  if (alreadySaved && live) {
    return <SaveAccessScreen state="already_saved" circleName={circleName} onBack={back} />;
  }

  if (step.kind === 'code') {
    const confirm = async () => {
      setBusy(true);
      setCodeProblem(undefined);
      setReference(undefined);
      try {
        await savePlace({
          moment: 'after_answer',
          signIn: () => submitLinkCode(step.address, codeText, step.route),
        });
        track('account_claimed', { moment: 'after_answer' });
        noteSavedWith(code, step.address);
        back();
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
      } finally {
        setBusy(false);
      }
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
        void askForCode(address).finally(() => setBusy(false));
      }}
      onNotNow={back}
      onBack={back}
    />
  );
}
