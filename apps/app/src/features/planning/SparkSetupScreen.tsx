import type { PlanCategory } from '@circles/domain';

import {
  Body,
  BodyText,
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
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';
import { CATEGORIES } from './form';
import type { WhenOption } from './PlanAnotherScreen';
import { PlanStateScreen } from './states';

/**
 * SparkSetup — `docs/design/SparkSetup.dc.html` (spec §5.4.1): "See if people
 * are keen". Four windows, what to do, and when to stop asking.
 *
 * The flow works out every chip (`QuietSetupFlow`): which windows can be asked
 * about now, and which stop times this window offers (`stopTimeOptions`). With
 * none on offer the ask cannot be made, so **Ask quietly** is off and the
 * screen says why rather than showing a button that does nothing. Its
 * defaults are the artboard's, for the canvas.
 */
export type SparkSetupProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  /** "Nobody sees who asked. If three people are keen, …" — this circle's threshold. */
  lede?: string | undefined;
  when?: readonly WhenOption[] | undefined;
  /** Why Tonight is off, when it is (S2-06). */
  whenNote?: string | undefined;
  category?: PlanCategory | undefined;
  onCategory?: ((category: PlanCategory) => void) | undefined;
  stopAsking?: readonly WhenOption[] | undefined;
  /** "Stops asking Fri 11 Sep, 12 pm." — or why there is nothing to pick. */
  stopLine?: string | undefined;
  /** Ask quietly cannot be sent: no stop time is on offer. */
  blocked?: boolean | undefined;
  problem?: string | undefined;
  reference?: string | undefined;
  busy?: boolean | undefined;
  onRetry?: (() => void) | undefined;
  /** The screen's one decision: Ask quietly. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

const ARTBOARD_WHEN = ['tonight', 'this_weekend', 'next_7_days', 'next_14_days'] as const;
const ARTBOARD_STOP = ['tonight_9_pm', 'friday_midday', 'when_the_weekend_starts'] as const;

/** The artboard calls "catch up" *Anything*: the ask is about meeting, not what for. */
function categoryWords(category: PlanCategory): string {
  switch (category) {
    case 'catch_up':
      return t('sparkSetup', 'anything');
    case 'dinner':
      return t('sparkSetup', 'dinner');
    case 'drinks':
      return t('sparkSetup', 'drinks');
    case 'coffee':
      return t('sparkSetup', 'coffee');
    case 'activity':
      return t('sparkSetup', 'activity');
  }
}

const artboard = (keys: readonly string[], selected: string, words: (key: string) => string) =>
  keys.map((key) => ({ key, label: words(key), selected: key === selected, onPress: () => {} }));

export function SparkSetupScreen(props: SparkSetupProps) {
  const {
    state = 'default',
    lede = t('sparkSetup', 'nobody_sees_who_asked', { threshold: 3 }),
    category = 'catch_up',
    busy = false,
    blocked = false,
    whenNote,
    stopLine,
    problem,
    reference,
  } = props;
  const when =
    props.when ??
    artboard(ARTBOARD_WHEN, 'this_weekend', (key) =>
      t('sparkSetup', key as (typeof ARTBOARD_WHEN)[number]),
    );
  const stop =
    props.stopAsking ??
    artboard(ARTBOARD_STOP, 'friday_midday', (key) =>
      t('sparkSetup', key as (typeof ARTBOARD_STOP)[number]),
    );

  if (state !== 'default') {
    return <PlanStateScreen state={state} onRetry={props.onRetry} onBack={props.onBack} />;
  }

  return (
    <Screen>
      <TopBar
        title={t('sparkSetup', 'see_if_people_are_keen')}
        onBack={props.onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Stack>
          <DisplayL>{t('sparkSetup', 'ask_quietly')}</DisplayL>
          <BodyText>{lede}</BodyText>
        </Stack>
        <Stack>
          <Label>{t('sparkSetup', 'for_when')}</Label>
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
          {whenNote === undefined ? null : <Small>{whenNote}</Small>}
        </Stack>
        <Stack>
          <Label>{t('sparkSetup', 'to_do_what')}</Label>
          <Chips>
            {CATEGORIES.map((c) => (
              <Chip
                key={c}
                label={categoryWords(c)}
                selected={category === c}
                onPress={() => props.onCategory?.(c)}
              />
            ))}
          </Chips>
        </Stack>
        <Stack>
          <Label>{t('sparkSetup', 'stop_asking')}</Label>
          {stop.length === 0 ? null : (
            <Chips>
              {stop.map((option) => (
                <Chip
                  key={option.key}
                  label={option.label}
                  selected={option.selected}
                  onPress={option.onPress}
                />
              ))}
            </Chips>
          )}
          {stopLine === undefined ? null : <Small>{stopLine}</Small>}
        </Stack>
        <Notice>{t('sparkSetup', 'in_a_group_this_size_people_can')}</Notice>
        {problem === undefined ? null : <Notice kind="warn">{problem}</Notice>}
        {reference === undefined ? null : (
          <Small>{t('planSetup', 'reference', { reference })}</Small>
        )}
      </Body>
      <Foot>
        <Button
          label={busy ? t('sparkSetup', 'asking') : t('sparkSetup', 'ask_quietly')}
          disabled={busy || blocked}
          onPress={props.onNext}
        />
      </Foot>
    </Screen>
  );
}
