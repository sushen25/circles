import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState, type ReactNode } from 'react';

import { track } from '../../analytics/track';
import { bootstrapProfile, useSession, type SaveMoment } from '../../data/auth';
import { newestCircleId } from '../../data/circles';
import { ownNameIn } from '../../data/membership';
import { SavePlaceByEmail } from '../identity/SavePlaceByEmail';
import { InitiateGateScreen, type InitiateGateIntent } from './InitiateGateScreen';
import { useNudge } from './useNudge';

/**
 * The organiser gate (ADR 0004, spec §5.1, §5.11): a guest who is about to
 * organise saves their place first — creating a circle, making a plan, a quiet
 * ask, taking the organiser role.
 *
 * **Rendered in place of the thing it guards**, not navigated to. The screen
 * underneath is the one the person asked for, and once `savePlace` has turned
 * the session into a saved place, the guard that put the gate there says
 * `allow` and that screen is simply drawn — the intended action is resumed by
 * never having been left. `onSaved` is for the doors where the action is a tap
 * rather than a screen (`useOrganiserGate`).
 *
 * Saving here links the existing guest membership (`claim-identity`), so the
 * person keeps their place, their name and every answer they have sent. The
 * profile is then given the name the circle knows them by: a guest's profile
 * is `Guest` until something writes it, and the circle they are about to
 * start takes its owner's name from there.
 */
export type InitiateGateFlowProps = {
  intent: InitiateGateIntent;
  /** The circle they are organising in, or came from. Else their newest. */
  circleId?: string | undefined;
  circleName?: string | undefined;
  /** Where the funnel says this happened. The gate's own, unless a prompt led here. */
  moment?: SaveMoment | undefined;
  onSaved?: (() => void) | undefined;
  onNotNow: () => void;
};

export function InitiateGateFlow({
  intent,
  circleId,
  circleName,
  moment = 'organiser_gate',
  onSaved,
  onNotNow,
}: InitiateGateFlowProps) {
  const session = useSession();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'gate' | 'email'>('gate');
  // Recorded, never suppressed: the gate is not a nudge and shows every time.
  const record = useNudge('organiser_gate');

  const name = useQuery({
    queryKey: ['gate-own-name', circleId, session.userId],
    queryFn: async () => {
      const where = circleId ?? (await newestCircleId());
      return where === undefined ? null : await ownNameIn(where);
    },
    enabled: session.userId !== undefined,
    staleTime: Infinity,
  });
  const known = name.data ?? undefined;

  const leave = () => {
    record.dismiss();
    onNotNow();
  };

  if (step === 'email') {
    return (
      <SavePlaceByEmail
        moment={moment}
        circleName={circleName}
        onSaved={async () => {
          track('account_claimed', { moment });
          // Their name in the circle, onto a profile still at the default. The
          // zone too, from the device, if it is still `UTC`. Neither failing
          // is a failed save: Your name and settings can each put it right.
          await bootstrapProfile(known === undefined ? {} : { name: known }).catch(() => undefined);
          await queryClient.invalidateQueries();
          onSaved?.();
        }}
        onNotNow={leave}
        onBack={() => setStep('gate')}
      />
    );
  }

  return (
    <InitiateGateScreen
      intent={intent}
      circleName={circleName}
      name={known}
      onContinueWithEmail={() => {
        record.tap();
        setStep('email');
      }}
      onNotNow={leave}
      onBack={leave}
    />
  );
}

/**
 * The gate for a door that is a **tap**, not a screen: "I'll pick the time",
 * "I'll organise", "Start a circle" (SUS-51 plugs its two in here).
 *
 * ```tsx
 * const organiser = useOrganiserGate({ circleId, circleName });
 * if (organiser.gate !== null) return organiser.gate;
 * <Button onPress={() => organiser.require(() => accept())} />
 * ```
 *
 * `require(action)` runs the action at once for a saved place. For a guest it
 * shows the gate instead, and runs the action once they have saved their
 * place — so the tap they made is the tap that happens. "Not now" drops it.
 */
export function useOrganiserGate(options: {
  circleId?: string | undefined;
  circleName?: string | undefined;
  intent?: InitiateGateIntent | undefined;
  moment?: SaveMoment | undefined;
}): { gate: ReactNode; require: (action: () => void) => void } {
  const session = useSession();
  const [waiting, setWaiting] = useState(false);
  const pending = useRef<(() => void) | undefined>(undefined);

  const require = useCallback(
    (action: () => void) => {
      if (session.status !== 'guest') {
        action();
        return;
      }
      pending.current = action;
      setWaiting(true);
    },
    [session.status],
  );

  const gate = waiting ? (
    <InitiateGateFlow
      intent={options.intent ?? 'plan'}
      circleId={options.circleId}
      circleName={options.circleName}
      moment={options.moment}
      onSaved={() => {
        const action = pending.current;
        pending.current = undefined;
        setWaiting(false);
        action?.();
      }}
      onNotNow={() => {
        pending.current = undefined;
        setWaiting(false);
      }}
    />
  ) : null;

  return { gate, require };
}
