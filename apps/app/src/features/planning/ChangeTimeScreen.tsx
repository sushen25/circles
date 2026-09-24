import type { ReactNode } from 'react';

import {
  Body,
  BodyText,
  Button,
  Card,
  Chip,
  Chips,
  DisplayL,
  Foot,
  Label,
  Notice,
  Screen,
  Small,
  Tertiary,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { ScreenState } from '../state';
import { SettingLine } from './parts';
import type { PlanControlsProps, WhenChip } from './PlanControls';
import { PlanStateScreen } from './states';

/**
 * ChangeTime — `docs/design/ChangeTime.dc.html` (spec §5.7): unpick the
 * locked-in time and ask again for a new window. It is `revise-plan`'s
 * `reopen`: the confirmation is superseded, the revision bumps, every answer
 * is cleared and everybody gets a fresh ask. The deadline row is there because
 * a fresh ask needs one still ahead (`deadline_out_of_range`).
 */
export type ChangeTimeProps = {
  state?: ScreenState | undefined;
  statement?: { title: string; body: string } | undefined;
  /** "Thursday". */
  day?: string | undefined;
  when?: WhenChip[] | undefined;
  closes?: PlanControlsProps['closes'] | undefined;
  problem?: string | undefined;
  refused?: string | undefined;
  reference?: string | undefined;
  busy?: boolean | undefined;
  canAsk?: boolean | undefined;
  sheets?: ReactNode;
  onRetry?: (() => void) | undefined;
  /** The screen's one decision: Ask again. */
  onNext?: (() => void) | undefined;
  onKeep?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function ChangeTimeScreen(props: ChangeTimeProps) {
  const { state = 'default', day, when, closes, busy = false } = props;
  if (state !== 'default' || day === undefined || when === undefined || closes === undefined) {
    return (
      <PlanStateScreen
        state={state === 'default' ? 'denied' : state}
        title={props.statement?.title}
        body={props.statement?.body}
        onRetry={props.onRetry}
        onBack={props.onBack}
      />
    );
  }

  return (
    <Screen>
      <TopBar
        title={t('changeTime', 'back')}
        onBack={props.onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Stack>
          <DisplayL>{t('changeTime', 'ask_for_new_times')}</DisplayL>
          <BodyText>{t('changeTime', 'body_day', { day })}</BodyText>
        </Stack>
        <Stack gap={10}>
          <Label>{t('changeTime', 'new_window')}</Label>
          <Chips>
            {when.map((chip) => (
              <Chip
                key={chip.key}
                label={chip.label}
                selected={chip.selected}
                disabled={chip.disabled}
                onPress={chip.onPress}
              />
            ))}
          </Chips>
        </Stack>
        <Card>
          <SettingLine title={closes.title} detail={closes.detail} onChange={closes.onChange} />
        </Card>
        {props.problem === undefined ? null : <Notice kind="warn">{props.problem}</Notice>}
        <Notice kind="warn">{t('changeTime', 'warn_day', { day })}</Notice>
        {props.refused === undefined ? null : <Notice kind="warn">{props.refused}</Notice>}
        {props.reference === undefined ? null : (
          <Small>{t('planSetup', 'reference', { reference: props.reference })}</Small>
        )}
      </Body>
      <Foot>
        <Button
          label={busy ? t('changeTime', 'asking') : t('changeTime', 'ask_again')}
          disabled={busy || props.canAsk !== true}
          onPress={props.onNext}
        />
        <Tertiary label={t('changeTime', 'keep_day', { day })} onPress={props.onKeep} />
      </Foot>
      {props.sheets}
    </Screen>
  );
}
