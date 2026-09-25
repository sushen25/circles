import { t } from '../../copy';
import type { QuietPlan, QuietView } from '../../data/planning';

/**
 * Which quiet-ask screen a reader gets (spec §5.4), from `quiet-view` alone.
 *
 * Nothing here decides who may do what: the view's capabilities do —
 * `mayWithdraw`, `mayTakeRole`, `showClosedNotice` — and this only turns them
 * into a screen. What it adds is the organiser, who is public once there is
 * one, so a member who took the role is sent to the organiser's own screens.
 *
 * **ThresholdRole and Volunteer are the same capability.** The initiator and a
 * keen member both have `mayTakeRole` once the ask opens, and the view does not
 * say which one is reading, by design. The difference is only what the
 * initiator has already seen: somebody who watched their own ask open, on this
 * device, gets "I'll organise / Ask for a volunteer"; anybody else, and the
 * initiator arriving from an email, gets "I'll pick the time" — which works for
 * them too. See `askedHere`.
 */
export type QuietScreen =
  | { kind: 'waiting'; closesAt: string; threshold: number }
  | { kind: 'prompt'; closesAt: string; answered: boolean }
  | { kind: 'threshold'; keenCount: number | null }
  | { kind: 'volunteer'; keenCount: number | null }
  | { kind: 'opened'; keenCount: number | null; organiser: string | null }
  | { kind: 'organising' }
  | { kind: 'closed_notice' }
  | { kind: 'closed' }
  | { kind: 'not_quiet' };

export function quietScreenOf(
  view: QuietView | null,
  plan: Pick<QuietPlan, 'id' | 'organiserUserId'>,
  me: string | undefined,
): QuietScreen {
  if (view === null) return { kind: 'not_quiet' };
  switch (view.phase) {
    case 'seeking':
      return view.may_withdraw
        ? { kind: 'waiting', closesAt: view.closes_at, threshold: view.threshold }
        : { kind: 'prompt', closesAt: view.closes_at, answered: view.answered_by_me };
    case 'opened':
      if (me !== undefined && plan.organiserUserId === me) return { kind: 'organising' };
      if (view.organiser === null && view.may_take_role) {
        return askedHere(plan.id, me)
          ? { kind: 'threshold', keenCount: view.keen_count }
          : { kind: 'volunteer', keenCount: view.keen_count };
      }
      return { kind: 'opened', keenCount: view.keen_count, organiser: view.organiser };
    case 'closed':
      return view.show_closed_notice ? { kind: 'closed_notice' } : { kind: 'closed' };
  }
}

/**
 * The asks this device has seen its own reader start, **in memory, this
 * session only** — never stored, never sent, gone on reload.
 *
 * It holds nothing the screen had not just been shown: `mayWithdraw` on
 * SparkWaiting is the same fact, on the same screen. It exists so that the
 * initiator watching their own ask open is offered what spec §5.4 offers them
 * ("I'll organise" or "Ask for a volunteer") rather than the volunteer's one
 * tap, and it is forgotten as soon as they choose.
 */
const asked = new Map<string, string>();

/**
 * Keyed by who was reading as well as by the plan: a browser signed out and
 * into somebody else's account keeps its JavaScript, and the next reader must
 * not inherit the last one's "you asked this".
 */
export function rememberAsked(planId: string, reader: string | undefined): void {
  if (reader !== undefined) asked.set(planId, reader);
}

export function forgetAsked(planId: string): void {
  asked.delete(planId);
}

export function askedHere(planId: string, reader: string | undefined): boolean {
  return reader !== undefined && asked.get(planId) === reader;
}

/** Test seam. */
export function forgetEveryAsk(): void {
  asked.clear();
}

/** "this weekend", "in the next 7 days" — the window an ask is about, as a phrase. */
export function quietWhen(preset: QuietPlan['preset']): string {
  switch (preset) {
    case 'tonight':
      return t('quiet', 'when_tonight');
    case 'this_weekend':
      return t('quiet', 'when_this_weekend');
    case 'next_7_days':
      return t('quiet', 'when_next_7_days');
    case 'next_14_days':
      return t('quiet', 'when_next_14_days');
    case null:
      return t('quiet', 'when_soon');
  }
}
