import type { DurationMinutes, Instant, PlanCategory, WindowPreset } from '@circles/domain';
import { useState } from 'react';

import { t } from '../../copy';
import { listOf } from '../scheduling/sentences';
import {
  bandKind,
  canStep,
  cellsPerDay,
  DAYTIME,
  EVENINGS,
  stepBand,
  type BandKind,
} from './bands';
import type { CustomWindowProps } from './CustomWindowScreen';
import {
  presetAvailable,
  PRESETS,
  quorumRange,
  tonightNote,
  type PlanDraft,
  type ResolveProblem,
} from './form';
import type { Band, DateRange } from './form';
import type { PlanControlsProps, WhenChip } from './PlanControls';
import type { DeadlineSheetProps, RequiredSheetProps } from './sheets';
import { useCustomWindow } from './useCustomWindow';
import { useDeadlineSheet } from './useDeadlineSheet';
import {
  closesIn,
  datesWords,
  presetLabel,
  problemWords,
  quorumLine,
  timeWords,
  tonightNoteWords,
} from './words';

/**
 * The plan form's state, shared by PlanSetup and EditPlan — the same controls,
 * one starting from defaults and one from the plan (spec §5.3).
 *
 * What the draft *means* is not decided here: the caller's `resolve` is the
 * domain's answer (`resolveDraft` for a new plan, `resolveEdit` for an edit),
 * and this turns the answer into what the controls show. Two rules of its own,
 * both about keeping the draft honest as it moves:
 *
 * - **New dates drop a chosen deadline.** A deadline picked for last week's
 *   window is not a choice about this one; the preset's default takes over and
 *   the row says so.
 * - **New dates bring their own hours**, unless the organiser chose the hours:
 *   the weekend's band is not the fortnight's (`dailyForRange`).
 */
export type FormPerson = { id: string; name: string };

export type FormContext = {
  zone: string;
  /** Who can be required: a new plan's circle, or the revision's participants. */
  people: FormPerson[];
  me: string | undefined;
  /** What the quorum is counted against: "At least 4 of 6". */
  members: number;
  /** The number an untouched quorum shows. */
  quorumShown: number;
  /** Whether an untouched quorum follows the circle (a new plan's, ADR 0026). */
  quorumFollows: boolean;
  /** The edit's own dates, offered as the first "When" chip, and the hours they had. */
  kept?: { window: DateRange; band: Band } | undefined;
  /** The first day the calendar offers, when later than today (Change the time). */
  notBefore?: string | undefined;
};

export type FormResolved =
  | { ok: true; window: DateRange; band: Band; latestStart: string; deadline: string }
  | { ok: false; problem: ResolveProblem };

export type PlanForm = {
  draft: PlanDraft;
  resolved: FormResolved;
  problem: string | undefined;
  step: 'form' | 'window';
  controls: PlanControlsProps;
  deadlineSheet: DeadlineSheetProps | undefined;
  requiredSheet: RequiredSheetProps;
  window: CustomWindowProps;
  touched: boolean;
  setCategory: (category: PlanCategory) => void;
};

const sameRange = (a: DateRange | undefined, b: DateRange | undefined) =>
  a !== undefined && b !== undefined && a.start === b.start && a.end === b.end;

export function usePlanForm({
  initial,
  context,
  now,
  resolve,
  closesDetail,
  startOn = 'form',
}: {
  initial: PlanDraft;
  context: FormContext;
  now: Instant;
  /** `/plan/window` opens on the calendar. */
  startOn?: 'form' | 'window' | undefined;
  resolve: (draft: PlanDraft) => FormResolved;
  closesDetail: (resolved: FormResolved & { ok: true }, draft: PlanDraft) => string;
}): PlanForm {
  const [draft, setDraft] = useState(initial);
  const [bandChosen, setBandChosen] = useState(false);
  const [bandMode, setBandMode] = useState<BandKind | undefined>();
  const [step, setStep] = useState<'form' | 'window'>(startOn);
  const [requiredOpen, setRequiredOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  const calendar = useCustomWindow(now, context.zone, draft.custom, context.notBefore);

  const change = (next: Partial<PlanDraft>) => {
    setTouched(true);
    setDraft((current) => ({ ...current, ...next }));
  };
  const newDates = (preset: WindowPreset, custom: DateRange | undefined) => {
    // Back to the plan's own dates brings back its own hours, not the ones a
    // custom range of those dates would suggest.
    const own = context.kept !== undefined && sameRange(custom, context.kept.window);
    const hours = bandChosen ? {} : { band: own ? context.kept?.band : undefined };
    change({ preset, custom, deadline: undefined, ...hours });
  };

  const resolved = resolve(draft);
  const band = resolved.ok ? resolved.band : (draft.band ?? EVENINGS);
  const kind = bandMode ?? bandKind(band);

  const bandPicker = {
    kind,
    from: timeWords(band.startMin),
    to: timeWords(band.endMin),
    cells: cellsPerDay(band),
    onKind: (next: BandKind) => {
      setBandChosen(true);
      setBandMode(next === 'custom' ? 'custom' : undefined);
      change({ band: next === 'evenings' ? EVENINGS : next === 'daytime' ? DAYTIME : band });
    },
    onStep: (edge: 'start' | 'end', direction: 1 | -1) => {
      setBandChosen(true);
      change({ band: stepBand(band, edge, direction) });
    },
    canStep: (edge: 'start' | 'end', direction: 1 | -1) => canStep(band, edge, direction),
  };

  const deadline = useDeadlineSheet({
    now,
    latestStart: resolved.ok ? resolved.latestStart : undefined,
    zone: context.zone,
    current: resolved.ok ? resolved.deadline : undefined,
    onPick: (at) => change({ deadline: at }),
  });

  const kept = context.kept?.window;
  const isKept = draft.preset === 'custom' && sameRange(draft.custom, kept);
  const openCalendar = () => {
    calendar.reset(draft.custom);
    setStep('window');
  };
  const when: WhenChip[] = [
    ...(kept === undefined
      ? []
      : [
          {
            key: 'kept',
            label: t('editPlan', 'these_dates', { dates: datesWords(kept) }),
            selected: isKept,
            onPress: () => newDates('custom', kept),
          },
        ]),
    ...PRESETS.map((preset) => {
      const custom = preset === 'custom';
      const selected = draft.preset === preset && !isKept;
      return {
        key: preset,
        label:
          custom && selected && draft.custom !== undefined
            ? t('planSetup', 'custom_dates', { dates: datesWords(draft.custom) })
            : presetLabel(preset),
        selected,
        disabled:
          !custom && !presetAvailable(preset, draft.band, draft.duration, now, context.zone),
        onPress: custom ? openCalendar : () => newDates(preset, undefined),
      };
    }),
  ];

  // The Tonight chip is never off without saying why (S2-06).
  const offTonight = tonightNote(draft.band, draft.duration, now, context.zone);

  const required = draft.required ?? (context.me === undefined ? [] : [context.me]);
  const requiredNames = [
    ...(context.me !== undefined && required.includes(context.me) ? [t('planSetup', 'you')] : []),
    ...context.people
      .filter((p) => p.id !== context.me && required.includes(p.id))
      .map((p) => p.name),
  ];
  const quorum = draft.quorum ?? context.quorumShown;
  const range = quorumRange(context.members);

  // The window step judges the dates being picked, with the hours in play.
  const trial =
    calendar.range === undefined
      ? undefined
      : resolve({ ...draft, preset: 'custom', custom: calendar.range, deadline: undefined });

  return {
    draft,
    resolved,
    problem: resolved.ok ? undefined : problemWords(resolved.problem),
    step,
    touched,
    setCategory: (category) => change({ category }),
    controls: {
      when,
      whenNote: offTonight === undefined ? undefined : tonightNoteWords(offTonight),
      band: bandPicker,
      duration: draft.duration,
      onDuration: (duration: DurationMinutes) => change({ duration }),
      quorum: {
        line: quorumLine(quorum, context.members),
        detail:
          context.quorumFollows && draft.quorum === undefined
            ? t('planSetup', 'quorum_adjusts')
            : t('planSetup', 'so_one_busy_week_doesnt_sink_the'),
        canFewer: quorum > range.min,
        canMore: quorum < range.max,
        onFewer: () => change({ quorum: Math.max(range.min, quorum - 1) }),
        onMore: () => change({ quorum: Math.min(range.max, quorum + 1) }),
      },
      required: {
        title: t('planSetup', 'required_title'),
        detail:
          required.length === 0
            ? t('planSetup', 'required_nobody')
            : required.length === 1 && required[0] === context.me
              ? t('planSetup', 'required_just_you')
              : (listOf(requiredNames) ?? t('planSetup', 'required_nobody')),
        onChange: context.people.length === 0 ? undefined : () => setRequiredOpen(true),
      },
      closes: resolved.ok
        ? {
            title: closesIn(resolved.deadline, now),
            detail: closesDetail(resolved, draft),
            onChange: deadline.open,
          }
        : { title: t('planSetup', 'closes_title'), detail: '' },
    },
    deadlineSheet: deadline.props,
    requiredSheet: {
      visible: requiredOpen,
      askedOnly: context.kept !== undefined,
      people: context.people.map((p) => ({
        key: p.id,
        label: p.id === context.me ? t('planSetup', 'you_named', { name: p.name }) : p.name,
        selected: required.includes(p.id),
      })),
      onToggle: (id) =>
        change({
          required: required.includes(id) ? required.filter((r) => r !== id) : [...required, id],
        }),
      onDone: () => setRequiredOpen(false),
    },
    window: {
      view: calendar,
      band: bandPicker,
      problem: trial !== undefined && !trial.ok ? problemWords(trial.problem) : undefined,
      onBack: () => setStep('form'),
      onNext: () => {
        if (calendar.range === undefined) return;
        newDates('custom', calendar.range);
        setStep('form');
      },
    },
  };
}
