import type { ReactNode } from 'react';

import {
  Body,
  Button,
  DisplayL,
  Foot,
  Notice,
  Screen,
  Small,
  Tertiary,
  TopBar,
} from '../../components';
import { t } from '../../copy';
import type { ScreenState } from '../state';
import { PlanControls, type PlanControlsProps } from './PlanControls';
import { PlanStateScreen } from './states';

/**
 * EditPlan — `docs/design/EditPlan.dc.html` (spec §5.3): the setup's
 * controls, prefilled, and — **before** Save — exactly who the change would
 * ask again, from `revise-plan`'s own preview (`useRevision`). A change that
 * asks nobody again says that instead, because quorum, deadline and required
 * members change what happens to the answers, not the question (ADR 0017).
 */
export type EditPlanProps = {
  state?: ScreenState | undefined;
  /** For a plan this person cannot edit: what is true, and where to go. */
  statement?: { title: string; body: string; action?: string; onAction?: () => void } | undefined;
  title?: string | undefined;
  controls?: PlanControlsProps | undefined;
  problem?: string | undefined;
  /** The re-ask sentence, or the no-cost one. Undefined before anything changes. */
  warning?: { text: string; asksAgain: boolean } | undefined;
  checking?: boolean | undefined;
  refused?: string | undefined;
  reference?: string | undefined;
  busy?: boolean | undefined;
  canSave?: boolean | undefined;
  sheets?: ReactNode;
  onRetry?: (() => void) | undefined;
  /** The screen's one decision: save. */
  onNext?: (() => void) | undefined;
  onKeepThePlanAs?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function EditPlanScreen(props: EditPlanProps) {
  const { state = 'default', controls, warning, busy = false, checking = false } = props;
  if (state !== 'default' || controls === undefined) {
    return (
      <PlanStateScreen
        state={state === 'default' ? 'denied' : state}
        title={props.statement?.title}
        body={props.statement?.body}
        action={props.statement?.action}
        onAction={props.statement?.onAction}
        onRetry={props.onRetry}
        onBack={props.onBack}
      />
    );
  }

  const label = busy
    ? t('editPlan', 'saving')
    : warning?.asksAgain === true
      ? t('editPlan', 'save_and_ask_again')
      : t('editPlan', 'save');

  return (
    <Screen>
      <TopBar
        title={t('editPlan', 'edit_plan')}
        onBack={props.onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <DisplayL>{props.title ?? t('editPlan', 'catch_up')}</DisplayL>
        <PlanControls {...controls} />
        {props.problem === undefined ? null : <Notice kind="warn">{props.problem}</Notice>}
        {checking ? (
          <Small accessibilityLiveRegion="polite">{t('editPlan', 'checking')}</Small>
        ) : warning === undefined ? null : (
          <Notice kind={warning.asksAgain ? 'warn' : 'plain'}>{warning.text}</Notice>
        )}
        {props.refused === undefined ? null : <Notice kind="warn">{props.refused}</Notice>}
        {props.reference === undefined ? null : (
          <Small>{t('planSetup', 'reference', { reference: props.reference })}</Small>
        )}
      </Body>
      <Foot>
        <Button label={label} disabled={busy || props.canSave !== true} onPress={props.onNext} />
        <Tertiary label={t('editPlan', 'keep_the_plan_as_it_is')} onPress={props.onKeepThePlanAs} />
      </Foot>
      {props.sheets}
    </Screen>
  );
}
