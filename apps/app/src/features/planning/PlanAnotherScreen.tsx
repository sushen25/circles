import type { PlanCategory } from '@circles/domain';

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
  TopBar,
} from '../../components';
import { Divider, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';
import { CATEGORIES } from './form';
import { SettingLine } from './parts';
import { PlanStateScreen } from './states';
import { categoryLabel } from './words';

/**
 * PlanAnother — `docs/design/PlanAnother.dc.html` (spec §5.9, §6.4): the
 * circle's next plan, filled in from the last meetup that happened, so that
 * asking again is one tap. What and when are chips here; how long, how many
 * and everything else are one line, "Same as last time", with **Change** to
 * the full setup. The flow works every line out (`PlanAnotherFlow`); this
 * draws them. Its defaults are the artboard's, for the canvas.
 */
export type WhenOption = {
  key: string;
  label: string;
  selected: boolean;
  onPress: () => void;
};

export type PlanAnotherProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  lede?: string | undefined;
  category?: PlanCategory | undefined;
  onCategory?: ((category: PlanCategory) => void) | undefined;
  when?: readonly WhenOption[] | undefined;
  /** "2 hours · at least 4 of 6". */
  summary?: string | undefined;
  closes?: string | undefined;
  closesAt?: string | undefined;
  /** Why it cannot be sent as it stands, or what the server said. */
  problem?: string | undefined;
  reference?: string | undefined;
  busy?: boolean | undefined;
  onChange?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  /** The screen's one decision: Ask the group. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onSeeIfPeopleAre?: (() => void) | undefined;
};

const ARTBOARD_WHEN = ['tonight', 'this_weekend', 'next_7_days', 'next_14_days', 'custom'] as const;

export function PlanAnotherScreen(props: PlanAnotherProps) {
  const {
    state = 'default',
    lede = t('planAnother', 'filled_in_from_septembers_catch_up_change'),
    category = 'catch_up',
    summary = t('planAnother', '2_hours_at_least_4_of_6'),
    closes = t('planAnother', 'replies_close_in_3_days'),
    closesAt = t('planAnother', 'fri_16_oct_6_pm'),
    problem,
    reference,
  } = props;
  const busy = props.busy ?? false;
  const when =
    props.when ??
    ARTBOARD_WHEN.map((key) => ({
      key,
      label: t('planAnother', key),
      selected: key === 'next_14_days',
      onPress: () => undefined,
    }));

  if (state !== 'default') {
    return <PlanStateScreen state={state} onRetry={props.onRetry} onBack={props.onBack} />;
  }

  return (
    <Screen>
      <TopBar
        title={t('planAnother', 'plan_another')}
        onBack={props.onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Stack>
          <DisplayL>{t('planAnother', 'same_as_last_time')}</DisplayL>
          <BodyText>{lede}</BodyText>
        </Stack>
        <Stack>
          <Label>{t('planAnother', 'what_are_we_doing')}</Label>
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
        <Stack>
          <Label>{t('planAnother', 'when')}</Label>
          <Chips>
            {when.map((option) => (
              <Chip
                key={option.key}
                label={option.label}
                selected={option.selected}
                onPress={option.onPress}
              />
            ))}
          </Chips>
        </Stack>
        <Card>
          <SettingLine
            title={summary}
            detail={t('planAnother', 'same_as_last_time_2')}
            onChange={props.onChange}
          />
          <Divider />
          <SettingLine title={closes} detail={closesAt} />
        </Card>
        {problem === undefined ? null : <Notice kind="warn">{problem}</Notice>}
        {reference === undefined ? null : (
          <Small>{t('planAnother', 'reference', { reference })}</Small>
        )}
      </Body>
      <Foot>
        <Button
          label={busy ? t('planAnother', 'asking') : t('planAnother', 'ask_the_group')}
          disabled={busy}
          onPress={props.onNext}
        />
        <Button
          label={t('planAnother', 'see_if_people_are_keen_instead')}
          variant="secondary"
          onPress={props.onSeeIfPeopleAre}
        />
      </Foot>
    </Screen>
  );
}
