import { StyleSheet, View } from 'react-native';

import {
  Body,
  BodyText,
  Button,
  DateText,
  DayGrid,
  DisplayL,
  Foot,
  Notice,
  Screen,
  Small,
  Tertiary,
  Title,
  Toggle,
  TopBar,
  type GridDay,
  type GridPaint,
  Loading,
  useLoadingHold,
} from '../../components';
import { Between, Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { AnswerLine } from './answerLine';
import type { BlockKind } from './blocks';
import { ChangeTimeSheet } from './ChangeTimeSheet';
import type { SheetView } from './view';

/**
 * Availability — `docs/design/Availability.dc.html` (spec §5.5, ADR 0024).
 *
 * Presentational: every string arrives worked out (`view.ts`) and every change
 * leaves as a callback, so the gallery can show each state and the container
 * (`Answering`) owns the plan, the draft and the network. Days first (ADR
 * 0068): tapping a day gives it the usual time of day, one line says the whole
 * answer, and "Change time" gives every tapped day another. The half hours
 * live on their own screen (`ExactHoursScreen`). Nothing here is said by colour
 * alone.
 */

export type AvailabilityState = 'default' | 'loading' | 'error' | 'offline' | 'expired';

export type AvailabilityProps = {
  state?: AvailabilityState | undefined;
  /** "Catch up · 12 – 23 Oct" */
  title?: string | undefined;
  /** The question: "Which days could work?", or "Which evenings…" on a plan with one window. */
  question?: string | undefined;
  /** "None of these dates work for me", or its evenings and mornings form. */
  noneLabel?: string | undefined;
  /** The plan leaves one window: the link under the line is "Adjust hours". */
  single?: boolean | undefined;
  /** Dragging across days taps or untaps them. */
  onPaintDays?: GridPaint | undefined;
  /** The one line of guidance under the question. */
  guide?: string | undefined;
  /** "Replies close Fri 23 Oct, 8:30 pm." */
  closes?: string | undefined;
  /** "Times are Melbourne time.", when the device is somewhere else. */
  zoneNote?: string | undefined;
  grid?: readonly GridDay[] | undefined;
  weekdays?: readonly string[] | undefined;
  /** The answer in a line, once any day is tapped. */
  answerLine?: AnswerLine | undefined;
  /** "Change time" is open. */
  sheetOpen?: boolean | undefined;
  sheet?: SheetView | undefined;
  flexible?: boolean | undefined;
  /** The plan changed under a draft (the rescheduled state). */
  changed?: boolean | undefined;
  problem?: string | undefined;
  reference?: string | undefined;
  busy?: boolean | undefined;
  onTick?: ((day: number) => void) | undefined;
  onChangeTime?: (() => void) | undefined;
  onChooseWindow?: ((kind: BlockKind) => void) | undefined;
  onExactHours?: (() => void) | undefined;
  onSheetDone?: (() => void) | undefined;
  onFlexible?: ((on: boolean) => void) | undefined;
  onSend?: (() => void) | undefined;
  onNoneOfTheseDates?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function AvailabilityScreen({
  state = 'default',
  title,
  question,
  noneLabel,
  single = false,
  onPaintDays,
  guide,
  closes,
  zoneNote,
  grid = [],
  weekdays = [],
  answerLine,
  sheetOpen = false,
  sheet,
  flexible = false,
  changed = false,
  problem,
  reference,
  busy = false,
  onTick,
  onChangeTime,
  onChooseWindow,
  onExactHours,
  onSheetDone,
  onFlexible,
  onSend,
  onNoneOfTheseDates,
  onRetry,
  onBack,
}: AvailabilityProps) {
  const loading = useLoadingHold(state === 'loading');
  if (loading) {
    return (
      <Loading
        message={t('availability', 'finding_the_plan')}
        shape="detail"
        onBack={onBack}
        onRetry={onRetry}
      />
    );
  }

  if (state === 'error' || state === 'offline') {
    return (
      <Screen>
        <TopBar title={title} onBack={onBack} backLabel={t('common', 'back')} />
        <Body>
          <DisplayL>
            {state === 'offline'
              ? t('availability', 'youre_offline')
              : t('availability', 'couldnt_load')}
          </DisplayL>
        </Body>
        <Foot>
          <Button label={t('availability', 'try_again')} onPress={onRetry} />
        </Foot>
      </Screen>
    );
  }

  if (state === 'expired') {
    return (
      <Screen>
        <TopBar title={title} onBack={onBack} backLabel={t('common', 'back')} />
        <Body>
          <Stack>
            <DisplayL>{t('availability', 'replies_closed')}</DisplayL>
            <BodyText>{t('availability', 'replies_closed_body')}</BodyText>
          </Stack>
        </Body>
        <Foot>
          <Tertiary label={t('availability', 'back')} onPress={onBack} />
        </Foot>
      </Screen>
    );
  }

  const canSend = flexible || answerLine !== undefined;
  // While an answer is on its way nothing that would change it is live: the
  // request carries the answer as it was when Send was pressed.
  const locked = busy;
  const dimmed = flexible || locked;

  return (
    <Screen>
      <TopBar title={title} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <DisplayL>{question ?? t('availability', 'which_days_could_work')}</DisplayL>
          {guide === undefined ? null : <BodyText>{guide}</BodyText>}
        </Stack>
        {changed ? <Notice kind="warn">{t('availability', 'plan_changed')}</Notice> : null}
        <DayGrid
          days={grid}
          weekdays={weekdays}
          label={t('availability', 'days_group')}
          onToggle={onTick}
          onPaint={onPaintDays}
          dimmed={dimmed}
        />
        <Stack gap={4}>
          {closes === undefined ? null : <Small>{closes}</Small>}
          {zoneNote === undefined ? null : <Small>{zoneNote}</Small>}
        </Stack>
        {answerLine === undefined ? null : (
          <View style={dimmed && styles.dimmed}>
            <Between>
              <View style={styles.line} aria-live="polite">
                <DateText style={styles.days}>{answerLine.days}</DateText>
                <BodyText>{answerLine.time}</BodyText>
              </View>
              <Tertiary
                label={t('availability', single ? 'adjust_hours' : 'change_time')}
                aria-label={t('availability', single ? 'adjust_hours_for' : 'change_time_for', {
                  days: answerLine.days,
                })}
                disabled={flexible}
                onPress={locked || flexible ? undefined : onChangeTime}
              />
            </Between>
          </View>
        )}
        <Row>
          <Stack>
            <Title>{t('availability', 'im_easy')}</Title>
            <Small>{t('availability', 'count_me_in_for_whatever_works_for')}</Small>
          </Stack>
          <Toggle
            value={flexible}
            onValueChange={(on) => onFlexible?.(on)}
            label={t('availability', 'im_easy')}
            disabled={locked}
          />
        </Row>
        <Notice>{t('availability', 'your_friends_see_who_can_make_each')}</Notice>
        {problem === undefined ? null : <Notice kind="warn">{problem}</Notice>}
        {reference === undefined ? null : (
          <Small>{t('availability', 'reference', { reference })}</Small>
        )}
      </Body>
      <Foot>
        <Button
          label={t('availability', 'send_my_times')}
          busyLabel={t('availability', 'sending')}
          busy={busy}
          onPress={onSend}
          disabled={!canSend}
        />
        <Tertiary
          tone="plain"
          label={noneLabel ?? t('availability', 'none_of_these_dates_work_for_me')}
          onPress={locked ? undefined : onNoneOfTheseDates}
        />
      </Foot>
      <ChangeTimeSheet
        visible={sheetOpen}
        sheet={sheet}
        onChoose={onChooseWindow}
        onExactHours={onExactHours}
        onDone={onSheetDone}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  line: { flexShrink: 1, gap: 4 },
  days: { fontSize: 24, lineHeight: 28 },
  dimmed: { opacity: 0.45 },
});
