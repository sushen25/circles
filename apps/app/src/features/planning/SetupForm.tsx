import { DURATIONS, fromISO, type DurationMinutes } from '@circles/domain';
import { useRef, useState } from 'react';

import { t } from '../../copy';
import { movedOn, usePlanClock } from './clock';
import { CustomWindowScreen } from './CustomWindowScreen';
import { defaultDraft, resolveDraft, type PlanDraft } from './form';
import { PlanSetupScreen } from './PlanSetupScreen';
import { refusalOf, type Refused } from './problems';
import { DeadlineSheet, RequiredSheet } from './sheets';
import { usePlanForm, type FormContext } from './usePlanForm';
import { closesDetail } from './words';

/**
 * The plan setup form, over a data source (spec §5.3): `PlanSetupFlow` gives it
 * a circle read from the server and a save that calls `create-plan`;
 * `PlanSetupDraftFlow` gives it a circle of one and a save that writes the
 * device's draft (ADR 0053). The screen, the controls and the validation are
 * the same either way.
 */
export function SetupForm({
  initial: opening,
  context,
  circleName,
  circleDuration,
  now,
  freshNow,
  startOn,
  draft = false,
  onAsk,
  onRefused,
  onBack,
}: {
  initial?: PlanDraft | undefined;
  context: FormContext;
  /** For the refusal that names the circle. Absent on fixtures. */
  circleName?: string | undefined;
  circleDuration: number;
  now: number;
  /**
   * The clock at the tap. The server resolves the preset when the plan is
   * made, so a form left open past midnight — or past tonight's last start —
   * would otherwise send a window it no longer shows. Absent on fixtures,
   * whose clock is fixed.
   */
  freshNow?: (() => number) | undefined;
  startOn: 'form' | 'window';
  /** Saved on this device, not sent: the button says so (ADR 0053). */
  draft?: boolean | undefined;
  onAsk: (draft: PlanDraft, touched: boolean) => Promise<void>;
  onRefused?: ((refused: Refused) => void) | undefined;
  onBack: () => void;
}) {
  // A default deadline is counted from when the plan is made, so the one on
  // screen keeps time with the clock rather than with when the form opened.
  const [clock, setClock] = usePlanClock(now, freshNow !== undefined);
  const instant = fromISO(new Date(clock).toISOString());
  const duration = (DURATIONS as readonly number[]).includes(circleDuration)
    ? (circleDuration as DurationMinutes)
    : 120;
  const [initial] = useState(() => opening ?? defaultDraft({ duration }));
  const form = usePlanForm({
    initial,
    context,
    now: instant,
    startOn,
    resolve: (draft) => resolveDraft(draft, instant, context.zone),
    // "You can pick sooner" while it is the default; once picked, it was.
    closesDetail: (resolved, draft) => closesDetail(resolved, draft, context.zone),
  });
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<Refused>();
  const inFlight = useRef(false);

  if (form.step === 'window') return <CustomWindowScreen {...form.window} />;

  const ask = async () => {
    if (inFlight.current || !form.resolved.ok) return;
    if (freshNow !== undefined) {
      const fresh = freshNow();
      const then = resolveDraft(form.draft, fromISO(new Date(fresh).toISOString()), context.zone);
      if (movedOn(form.resolved, then, form.draft.deadline === undefined)) {
        // Show what would be made now, and let the organiser ask again.
        setClock(fresh);
        setRefused({ message: t('planSetup', 'problem_moved_on'), conclusive: true });
        return;
      }
    }
    inFlight.current = true;
    setBusy(true);
    setRefused(undefined);
    try {
      await onAsk(form.draft, form.touched);
    } catch (error) {
      const answer = refusalOf(error, { circleName });
      setRefused(answer);
      onRefused?.(answer);
      setBusy(false);
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <PlanSetupScreen
      category={form.draft.category}
      onCategory={form.setCategory}
      controls={form.controls}
      problem={form.problem}
      refused={refused?.message}
      reference={refused?.reference}
      busy={busy}
      draft={draft}
      onNext={() => void ask()}
      onBack={onBack}
      sheets={
        <>
          {form.deadlineSheet === undefined ? null : <DeadlineSheet {...form.deadlineSheet} />}
          <RequiredSheet {...form.requiredSheet} />
        </>
      }
    />
  );
}
