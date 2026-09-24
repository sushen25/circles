import type { PlanCategory } from '@circles/domain';
import type { ReactNode } from 'react';

import {
  Body,
  Button,
  Chip,
  Chips,
  DisplayL,
  Foot,
  Label,
  Notice,
  Screen,
  Small,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { ScreenState } from '../state';
import { CATEGORIES } from './form';
import { PlanControls, type PlanControlsProps } from './PlanControls';
import { PlanStateScreen } from './states';
import { categoryLabel } from './words';

/**
 * PlanSetup — `docs/design/PlanSetup.dc.html` (spec §5.3): what, when, which
 * hours, how long, how many, who has to be there and when replies close; then
 * **Ask the group**. Every line is worked out by the flow from the domain's
 * rules (`usePlanForm`); this draws them.
 */
export type PlanSetupProps = {
  state?: ScreenState | undefined;
  /** Absent outside the default state, which is the only one with a form. */
  category?: PlanCategory | undefined;
  onCategory?: ((category: PlanCategory) => void) | undefined;
  controls?: PlanControlsProps | undefined;
  /** Why the form cannot be sent as it stands, pointing at the control. */
  problem?: string | undefined;
  /** What the server said, after a tap. */
  refused?: string | undefined;
  reference?: string | undefined;
  busy?: boolean | undefined;
  /** The sheets, drawn over the form. */
  sheets?: ReactNode;
  onRetry?: (() => void) | undefined;
  /** The screen's one decision: Ask the group. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function PlanSetupScreen(props: PlanSetupProps) {
  const { state = 'default', category = 'catch_up', controls, problem, refused, reference } = props;
  const busy = props.busy ?? false;
  if (state !== 'default' || controls === undefined) {
    return <PlanStateScreen state={state} onRetry={props.onRetry} onBack={props.onBack} />;
  }

  return (
    <Screen>
      <TopBar
        title={t('planSetup', 'plan_openly')}
        onBack={props.onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <DisplayL>{categoryLabel(category)}</DisplayL>
        <Stack gap={10}>
          <Label>{t('planSetup', 'what_are_we_doing')}</Label>
          <Chips>
            {CATEGORIES.map((c) => (
              <Chip
                key={c}
                label={categoryLabel(c)}
                selected={category === c}
                onPress={() => props.onCategory?.(c)}
              />
            ))}
          </Chips>
        </Stack>
        <PlanControls {...controls} />
        {problem === undefined ? null : <Notice kind="warn">{problem}</Notice>}
        {refused === undefined ? null : <Notice kind="warn">{refused}</Notice>}
        {reference === undefined ? null : (
          <Small>{t('planSetup', 'reference', { reference })}</Small>
        )}
      </Body>
      <Foot>
        <Button
          label={busy ? t('planSetup', 'asking') : t('planSetup', 'ask_the_group')}
          disabled={busy || problem !== undefined}
          onPress={props.onNext}
        />
        <Small>{t('planSetup', 'well_give_you_a_short_message_to')}</Small>
      </Foot>
      {props.sheets}
    </Screen>
  );
}
