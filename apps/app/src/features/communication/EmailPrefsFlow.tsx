import type { ManageEmailPreferencesResponse } from '@circles/contracts';
import { useEffect, useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { hasBackend } from '../../data/auth/client';
import { managePreferences, type PreferencesAction } from '../../data/email';
import { heldToken } from '../../data/links/tokens';
import { failureOf } from '../identity/join/failure';
import { EmailPrefsScreen, type EmailPrefsProps, type EmailPrefsState } from './EmailPrefsScreen';

/**
 * `/e#<token>` — email preferences with no sign-in (spec §5.8, ADR 0019,
 * ADR 0023).
 *
 * Every change answers with the whole list, so the page shows what the server
 * says rather than what it asked for. **After a removal it does not read
 * again**: the token dies with the address, and a second read would answer
 * `link_expired` and look like a failure of the thing that just worked.
 */
export function EmailPrefsFlow() {
  const [token] = useState(() => heldToken('preferences'));
  const [state, setState] = useState<EmailPrefsState>(
    token === undefined || !hasBackend() ? 'no_token' : 'loading',
  );
  const [answer, setAnswer] = useState<ManageEmailPreferencesResponse | undefined>();
  const [stopping, setStopping] = useState<string | undefined>();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [problem, setProblem] = useState<EmailPrefsProps['problem']>();
  const [reference, setReference] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);
  const ran = useRef(-1);

  const fail = (error: unknown, whileLoading: boolean) => {
    const failure = failureOf(error);
    if (failure.kind === 'reason' && failure.reason === 'link_expired') {
      setState('expired');
      return;
    }
    const reference = failure.kind === 'offline' ? undefined : failure.reference;
    setReference(reference);
    if (whileLoading) setState(failure.kind === 'offline' ? 'offline' : 'error');
    else setProblem(failure.kind === 'offline' ? 'offline' : 'couldnt_change');
  };

  useEffect(() => {
    if (token === undefined || !hasBackend() || ran.current === attempt) return;
    ran.current = attempt;
    managePreferences(token, { action: 'view' })
      .then((view) => {
        setAnswer(view);
        setState(view.removed ? 'removed' : 'default');
      })
      .catch((error: unknown) => fail(error, true));
  }, [token, attempt]);

  const change = async (request: PreferencesAction) => {
    if (token === undefined) return;
    setProblem(undefined);
    setReference(undefined);
    try {
      const next = await managePreferences(token, request);
      setAnswer(next);
      if (request.action === 'stop_plan') {
        track('email_subscription_changed', { enabled: false });
      }
      if (next.removed) setState('removed');
    } catch (error) {
      fail(error, false);
    }
  };

  return (
    <EmailPrefsScreen
      state={state}
      subscriptions={(answer?.subscriptions ?? []).map((subscription) => ({
        planId: subscription.plan_id,
        circleName: subscription.circle_name,
        planTitle: subscription.plan_title,
        active: subscription.active,
      }))}
      stopping={stopping}
      confirmingRemove={confirmingRemove}
      removing={removing}
      problem={problem}
      reference={reference}
      onStop={(planId) => {
        setStopping(planId);
        void change({ action: 'stop_plan', planId }).finally(() => setStopping(undefined));
      }}
      onRemove={() => setConfirmingRemove(true)}
      onKeep={() => setConfirmingRemove(false)}
      onConfirmRemove={() => {
        setRemoving(true);
        void change({ action: 'remove_contact' }).finally(() => setRemoving(false));
      }}
      onRetry={() => {
        setState('loading');
        setAttempt((n) => n + 1);
      }}
    />
  );
}
