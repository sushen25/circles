import type { VerifyEmailContactResponse } from '@circles/contracts';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { t } from '../../copy';
import { track } from '../../analytics/track';
import { hasBackend } from '../../data/auth/client';
import { takeSavedWith } from '../../data/auth/saved';
import { useSession } from '../../data/auth/session';
import { verifyEmail } from '../../data/email';
import { heldToken, releaseToken } from '../../data/links/tokens';
import { failureOf } from '../identity/join/failure';
import { LinkTapScreen } from './LinkTapScreen';
import { EmailVerifiedScreen, type EmailVerifiedState } from './EmailVerifiedScreen';

/**
 * `/v#<token>` — the verification link (spec §5.8, ADR 0023).
 *
 * **It asks for one tap and spends nothing before it.** Opening the link only
 * shows "Turn on updates"; the token is posted when the person taps. A mail
 * gateway that loads the page and runs its script would otherwise verify an
 * address a stranger typed, and plan mail would start for someone who never
 * asked. No read-only preview of the token exists, so the card does not name
 * the circle; the answer to the tap does.
 *
 * No session is needed or made: the token is the authorisation, it is posted
 * once, and the answer names the plans by title and circle so the page can say
 * what was turned on. An expired, spent or invented token is one answer,
 * `link_expired`, and the page does not try to tell them apart.
 */
export function EmailVerifyFlow() {
  const router = useRouter();
  const session = useSession();
  const [token] = useState(() => heldToken('verify'));
  // Taken for this screen alone: the held copy goes (ADR 0023).
  useEffect(() => releaseToken('verify'), []);
  const [state, setState] = useState<EmailVerifiedState | 'ready'>(
    token === undefined || !hasBackend() ? 'no_token' : 'ready',
  );
  const [answer, setAnswer] = useState<VerifyEmailContactResponse | undefined>();
  const [reference, setReference] = useState<string | undefined>();
  // Zero until the person taps; the effect below posts for each attempt after.
  const [attempt, setAttempt] = useState(0);
  const ran = useRef(0);

  useEffect(() => {
    if (token === undefined || !hasBackend() || attempt === 0 || ran.current === attempt) return;
    ran.current = attempt;
    verifyEmail(token)
      .then((verified) => {
        track('email_verified', {});
        setAnswer(verified);
        setState('default');
      })
      .catch((error: unknown) => {
        const failure = failureOf(error);
        if (failure.kind === 'offline') {
          setState('offline');
        } else if (failure.kind === 'reason' && failure.reason === 'link_expired') {
          setState('expired');
        } else {
          setReference(failure.reference);
          setState('error');
        }
      });
  }, [token, attempt]);

  const first = answer?.active_plans[0];

  // Back from saving access, which was started here: say so, once.
  const [savedWith, setSavedWith] = useState<string | undefined>();
  const firstCode = first?.short_code;
  useFocusEffect(
    useCallback(() => {
      if (firstCode === undefined) return;
      const address = takeSavedWith(firstCode);
      if (address !== undefined) setSavedWith(address);
    }, [firstCode]),
  );

  if (state === 'ready') {
    return (
      <LinkTapScreen
        title={t('emailVerified', 'turn_on_updates_title')}
        body={t('emailVerified', 'turn_on_updates_body')}
        button={t('emailVerified', 'turn_on_updates')}
        busyLabel={t('emailVerified', 'turning_on')}
        onConfirm={() => {
          setState('loading');
          setAttempt(1);
        }}
      />
    );
  }

  return (
    <EmailVerifiedScreen
      state={state}
      plans={(answer?.active_plans ?? []).map((plan) => ({
        key: plan.plan_id,
        circleName: plan.circle_name,
        planTitle: plan.plan_title,
      }))}
      alreadyConfirmed={answer?.already_confirmed ?? false}
      reference={reference}
      savedWith={savedWith}
      // Only where the guest who answered is: saving a place from a mail app's
      // browser, which holds nobody, would make an account with nothing in it.
      offerSaveAccess={session.status === 'guest' && first !== undefined}
      onBackToCircle={() => {
        if (first !== undefined) {
          router.replace({ pathname: '/p/[code]', params: { code: first.short_code } });
        }
      }}
      onSaveAccess={() => {
        if (first !== undefined) {
          router.push({ pathname: '/j/[code]/save-access', params: { code: first.short_code } });
        }
      }}
      onRetry={() => {
        setState('loading');
        setAttempt((n) => n + 1);
      }}
    />
  );
}
