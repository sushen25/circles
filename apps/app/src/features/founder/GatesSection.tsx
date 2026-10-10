import {
  GATES,
  judgeGate,
  type FounderAnalytics,
  type Gate,
  type JudgedGate,
} from '@circles/contracts';

import { Card, Label, Small, Title } from '../../components';
import { Divider, Stack } from '../../components/layout';
import { t } from '../../copy';
import { percent, waitOf } from './figures';

/**
 * The decision gates (spec §11.4), one row each: the measure, its target, the
 * value and how many it rests on, and whether it is met, not met or has too few
 * answers to say. Whether it is met is `judgeGate`'s, in `@circles/contracts`.
 *
 * Each cohort's gates are counted over that cohort's circles alone (ADR 0058);
 * nothing is pooled, and the screen says how many circles each rests on.
 *
 * A gate nothing computes reads "Not measured" with what is missing: never a
 * blank, never a zero.
 */
export function GatesSection({ data }: { data: FounderAnalytics }) {
  return (
    <>
      <Cohort cohort="founder" title={t('founderAnalytics', 'gates_founder')} data={data} />
      <Cohort cohort="external" title={t('founderAnalytics', 'gates_external')} data={data} />
    </>
  );
}

function Cohort({
  cohort,
  title,
  data,
}: {
  cohort: Gate['cohort'];
  title: string;
  data: FounderAnalytics;
}) {
  const gates = GATES.filter((gate) => gate.cohort === cohort);
  return (
    <Stack gap={10}>
      <Label>{title}</Label>
      {cohort === 'founder' ? <Small>{t('founderAnalytics', 'gates_detail')}</Small> : null}
      <Small>{circlesOf(data.cohort_circles[cohort] ?? 0)}</Small>
      <Small>{t('founderAnalytics', 'gates_placement_note')}</Small>
      <Card gap={14}>
        {gates.map((gate, index) => (
          <Stack key={gate.id} gap={10}>
            {index === 0 ? null : <Divider />}
            <GateRow gate={gate} judged={judgeGate(gate, data)} />
          </Stack>
        ))}
      </Card>
    </Stack>
  );
}

/** How many circles a cohort's gates are counted over: a number, never which. */
function circlesOf(count: number): string {
  return count === 1
    ? t('founderAnalytics', 'gates_cohort_circles_one')
    : t('founderAnalytics', 'gates_cohort_circles', { count });
}

function GateRow({ gate, judged }: { gate: Gate; judged: JudgedGate }) {
  const words = wordsOf(gate.id);
  return (
    <Stack gap={4}>
      <Label>{statusOf(judged)}</Label>
      <Title>{words.measure}</Title>
      <Small>{t('founderAnalytics', 'target', { label: words.target })}</Small>
      {judged.status === 'not_measured' ? (
        words.missing === undefined ? null : (
          <Small>{t('founderAnalytics', 'missing', { label: words.missing })}</Small>
        )
      ) : (
        <Small>{valueOf(gate, judged)}</Small>
      )}
      {words.note === undefined ? null : <Small>{words.note}</Small>}
    </Stack>
  );
}

function statusOf(judged: JudgedGate): string {
  switch (judged.status) {
    case 'met':
      return t('founderAnalytics', 'status_met');
    case 'not_met':
      return t('founderAnalytics', 'status_not_met');
    case 'too_few':
      return t('founderAnalytics', 'status_too_few');
    case 'not_measured':
      return t('founderAnalytics', 'status_not_measured');
  }
}

function valueOf(gate: Gate, judged: Exclude<JudgedGate, { status: 'not_measured' }>): string {
  if (gate.kind === 'count') return t('founderAnalytics', 'value_count', { count: judged.n });
  if (judged.value === null) return t('founderAnalytics', 'none_yet');
  if (gate.kind === 'median') {
    return t('founderAnalytics', 'value_n', { label: waitOf(judged.value), count: judged.n });
  }
  return t('founderAnalytics', 'value_of', {
    label: percent(judged.value),
    count: judged.numerator ?? 0,
    total: judged.denominator ?? 0,
  });
}

type Words = { measure: string; target: string; missing?: string; note?: string };

/** Each gate's words. A gate added to the contracts is a compile error here until it has some. */
function wordsOf(id: Gate['id']): Words {
  switch (id) {
    case 'confirmed_meetup':
      return {
        measure: t('founderAnalytics', 'gate_confirmed_meetup_measure'),
        target: t('founderAnalytics', 'gate_confirmed_meetup_target'),
      };
    case 'unchased':
      return {
        measure: t('founderAnalytics', 'gate_unchased_measure'),
        target: t('founderAnalytics', 'gate_unchased_target'),
        note: t('founderAnalytics', 'gate_unchased_note'),
      };
    case 'response_time':
      return {
        measure: t('founderAnalytics', 'gate_response_time_measure'),
        target: t('founderAnalytics', 'gate_response_time_target'),
        note: t('founderAnalytics', 'gate_response_time_note'),
      };
    case 'happened':
      return {
        measure: t('founderAnalytics', 'gate_happened_measure'),
        target: t('founderAnalytics', 'gate_happened_target'),
      };
    case 'reattach':
      return {
        measure: t('founderAnalytics', 'gate_reattach_measure'),
        target: t('founderAnalytics', 'gate_reattach_target'),
        note: t('founderAnalytics', 'gate_reattach_note'),
      };
    case 'second_meetup':
      return {
        measure: t('founderAnalytics', 'gate_second_meetup_measure'),
        target: t('founderAnalytics', 'gate_second_meetup_target'),
      };
    case 'other_organiser':
      return {
        measure: t('founderAnalytics', 'gate_other_organiser_measure'),
        target: t('founderAnalytics', 'gate_other_organiser_target'),
        note: t('founderAnalytics', 'gate_other_organiser_note'),
      };
    case 'email_verified':
      return {
        measure: t('founderAnalytics', 'gate_email_verified_measure'),
        target: t('founderAnalytics', 'gate_email_verified_target'),
        note: t('founderAnalytics', 'gate_email_verified_note'),
      };
    case 'confirm_in_week':
      return {
        measure: t('founderAnalytics', 'gate_confirm_in_week_measure'),
        target: t('founderAnalytics', 'gate_confirm_in_week_target'),
      };
    case 'another_in_cadence':
      return {
        measure: t('founderAnalytics', 'gate_another_in_cadence_measure'),
        target: t('founderAnalytics', 'gate_another_in_cadence_target'),
      };
    case 'claim_moments':
      return {
        measure: t('founderAnalytics', 'gate_claim_moments_measure'),
        target: t('founderAnalytics', 'gate_claim_moments_target'),
      };
    case 'app_moments':
      return {
        measure: t('founderAnalytics', 'gate_app_moments_measure'),
        target: t('founderAnalytics', 'gate_app_moments_target'),
        missing: t('founderAnalytics', 'gate_app_moments_missing'),
      };
    case 'willingness_to_pay':
      return {
        measure: t('founderAnalytics', 'gate_willingness_to_pay_measure'),
        target: t('founderAnalytics', 'gate_willingness_to_pay_target'),
        missing: t('founderAnalytics', 'gate_willingness_to_pay_missing'),
      };
    default:
      // A gate declared in the contracts with no words yet. Said plainly rather
      // than left blank: the gate is still a gate.
      return { measure: id, target: '' };
  }
}
