import { StyleSheet, View } from 'react-native';

import {
  Body,
  BodyText,
  Button,
  Card,
  Chip,
  Chips,
  DayGrid,
  DisplayL,
  Foot,
  Loading,
  Notice,
  Screen,
  Small,
  Step,
  Tertiary,
  TopBar,
  useLeave,
  useLoadingHold,
  type Go,
  type GridDay,
  type GridPaint,
} from '../../components';
import { Between, Stack } from '../../components/layout';
import { t } from '../../copy';
import { stepOf } from '../circles/FirstCircleScreen';
import type { ScreenState } from '../state';
import { LoadFailed } from '../system/LoadFailed';
import type { WhenChip } from './PlanControls';

/**
 * FirstEvenings — screen 2 of the first run (SUS-247, spec §5.1): which evenings
 * could the organiser do. Friends get the same question, so the organiser answers
 * it first, on the plan's own calendar, before there is an account.
 *
 * One decision: the days. The window is three chips; the calendar is the
 * guests' (`DayGrid`: tap or drag, a fill and a check, no transition); the plan
 * is one line with **Adjust**, which opens the sheet. **Next** waits until a day
 * is picked and says so if it is pressed early; **I'll add mine later** is for
 * the organiser who would rather not, and is only there while nothing is.
 *
 * A signed-in organiser's primary is **Make the link**: there is no gate to
 * pass, so this is the last screen before the share.
 */
export type FirstEveningsProps = {
  state?: ScreenState | undefined;
  circleName?: string | undefined;
  /** 3 for a new organiser, 2 once signed in. */
  steps?: 2 | 3 | undefined;
  heading?: string | undefined;
  windows?: WhenChip[] | undefined;
  weekdays?: string[] | undefined;
  days?: GridDay[] | undefined;
  gridLabel?: string | undefined;
  onToggle?: ((index: number) => void) | undefined;
  onPaint?: GridPaint | undefined;
  /** "Evenings · about 2 hours · replies close Sun 6 pm". */
  planLine?: string | undefined;
  /** How many days are picked. */
  picked?: number | undefined;
  /** A day is picked, or the organiser chose to add theirs later: Next may go on. */
  ready?: boolean | undefined;
  /** Next was pressed with nothing picked: the line that says what is missing. */
  missing?: string | undefined;
  /** The primary says Make the link, for somebody signed in already. */
  makesTheLink?: boolean | undefined;
  busy?: boolean | undefined;
  problem?: 'offline' | 'couldnt_make_the_link' | undefined;
  sheet?: React.ReactNode;
  onAdjust?: (() => void) | undefined;
  onLater?: ((go: Go) => void) | undefined;
  onNext?: ((go: Go) => void) | undefined;
  onRetry?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function FirstEveningsScreen({
  state = 'default',
  circleName = t('firstPlan', 'sunday_crew'),
  steps = 3,
  heading = t('firstRun', 'heading_evenings'),
  windows = [],
  weekdays = [],
  days = [],
  gridLabel = t('firstRun', 'grid_label'),
  onToggle,
  onPaint,
  planLine = '',
  picked = 0,
  ready = picked > 0,
  missing,
  makesTheLink = false,
  busy = false,
  problem,
  sheet,
  onAdjust,
  onLater,
  onNext,
  onRetry,
  onBack,
}: FirstEveningsProps) {
  const leave = useLeave();
  const loading = useLoadingHold(state === 'loading');
  if (loading) {
    return (
      <Loading
        message={t('firstPlan', 'loading')}
        shape="detail"
        topTitle={circleName}
        onBack={onBack}
        onRetry={onRetry}
      />
    );
  }
  if (state === 'error' || state === 'offline') {
    return (
      <LoadFailed
        state={state}
        message={t('firstPlan', state === 'offline' ? 'youre_offline' : 'couldnt_load')}
        where="circles"
        onBack={onBack}
        onRetry={onRetry}
      />
    );
  }

  const go: Go = (navigate) => leave('forward', navigate);

  return (
    <Screen>
      <TopBar
        title={circleName}
        step={stepOf(2, steps)}
        onBack={onBack === undefined ? undefined : () => leave('back', onBack)}
        backLabel={t('common', 'back')}
      />
      <Step>
        <Body>
          <Stack>
            <DisplayL>{heading}</DisplayL>
            <BodyText>{t('firstRun', 'same_question')}</BodyText>
          </Stack>
          <View role="radiogroup" aria-label={t('firstRun', 'when_label')}>
            <Chips>
              {windows.map((chip) => (
                <Chip
                  key={chip.key}
                  label={chip.label}
                  selected={chip.selected}
                  disabled={chip.disabled}
                  compact
                  onPress={chip.onPress}
                />
              ))}
            </Chips>
          </View>
          <DayGrid
            days={days}
            weekdays={weekdays}
            label={gridLabel}
            onToggle={onToggle}
            onPaint={onPaint}
            cell={50}
          />
          {picked > 0 ? null : (
            <View style={styles.later}>
              <Tertiary label={t('firstRun', 'later')} onPress={() => onLater?.(go)} />
              <Small accessibilityLiveRegion="polite">{missing ?? ' '}</Small>
            </View>
          )}
          <Card padding={14} gap={0}>
            <Between>
              <View style={styles.line}>
                <Small>{planLine}</Small>
              </View>
              <Tertiary
                label={t('firstRun', 'adjust')}
                accessibilityHint={t('firstRun', 'adjust_hint')}
                onPress={onAdjust}
              />
            </Between>
          </Card>
          {problem === undefined ? null : (
            <Notice kind="warn">
              {problem === 'offline'
                ? t('firstPlan', 'youre_offline')
                : t('firstRun', 'couldnt_make_the_link')}
            </Notice>
          )}
        </Body>
        <Foot>
          <Button
            label={makesTheLink ? t('firstRun', 'make_the_link') : t('firstRun', 'next')}
            busyLabel={t('firstRun', 'making_the_link')}
            busy={busy}
            waiting={!ready}
            onPress={() => onNext?.(go)}
          />
        </Foot>
      </Step>
      {sheet}
    </Screen>
  );
}

const styles = StyleSheet.create({
  later: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  line: { flexShrink: 1 },
});
