import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Body,
  BodyText,
  Button,
  CompactButton,
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
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import { AnswerBlock } from './AnswerBlock';
import type { BlockKind } from './blocks';
import { DayHoursSheet } from './DayHoursSheet';
import type { AnswerBlockView, DayRowView } from './view';
import { LoadFailed } from '../system/LoadFailed';

/**
 * Availability — `docs/design/Availability.dc.html` (spec §5.5, ADR 0024).
 *
 * Presentational: every string arrives worked out (`view.ts`) and every change
 * leaves as a callback, so the gallery can show each state and the container
 * (`Answering`) owns the plan, the draft and the network. Days first (ADR
 * 0068): tapping a day gives it the usual time of day, and the block under the
 * grid (`AnswerBlock`, ADR 0079) is that time of day as pills, which a tap
 * gives every tapped day, or a row for each day. A day's half hours are its
 * clock's sheet (`DayHoursSheet`). Nothing here is said by colour alone.
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
  /** What Send says when it is pressed before any day is tapped: "Tap at least one evening first." */
  sendHint?: string | undefined;
  /** Who picks next, for the closed screen: "Maya picks a time next." */
  organiserName?: string | null | undefined;
  /** The closed screen's way on: the options, which are readable once replies close. */
  onSeeOptions?: (() => void) | undefined;
  /** The plan leaves one window: the link under the line is "Adjust hours". */
  single?: boolean | undefined;
  /** Dragging across days taps or untaps them. */
  onPaintDays?: GridPaint | undefined;
  /** The one line of guidance under the question. */
  guide?: string | undefined;
  /**
   * The longer line the guidance may become, held as room while the read of
   * the others is on its way, so the grid does not move when it arrives
   * (SUS-136). Never shown or read out; absent once the read has settled, so a
   * failed read leaves the editor as it was.
   */
  guideRoom?: string | undefined;
  /** "Replies close Fri 23 Oct, 8:30 pm." */
  closes?: string | undefined;
  /** "Times are Melbourne time.", when the device is somewhere else. */
  zoneNote?: string | undefined;
  grid?: readonly GridDay[] | undefined;
  weekdays?: readonly string[] | undefined;
  /** "When, on those days?", once any day is tapped. */
  block?: AnswerBlockView | undefined;
  /** "A time for each day" is on show in its place. */
  expanded?: boolean | undefined;
  /** A row for each tapped day. */
  rows?: readonly DayRowView[] | undefined;
  /** "Your hours each evening", on a plan with one window. */
  singleHeading?: string | undefined;
  /** The day whose clock was tapped: its hours are on a sheet. */
  sheetRow?: DayRowView | undefined;
  /** "Evening": the choice that day had before its clock was tapped. */
  backTo?: string | undefined;
  flexible?: boolean | undefined;
  /** "Use my usual days", with the usual said in words; absent when it is not on offer (SUS-227). */
  usual?: { says: string } | undefined;
  /** The answer is what the usual days filled in: "Filled in from your usual days. Undo". */
  filledFromUsual?: boolean | undefined;
  /** The plan changed under a draft (the rescheduled state). */
  changed?: boolean | undefined;
  problem?: string | undefined;
  reference?: string | undefined;
  busy?: boolean | undefined;
  onUseUsual?: (() => void) | undefined;
  onUndoUsual?: (() => void) | undefined;
  onTick?: ((day: number) => void) | undefined;
  onChooseWindow?: ((kind: BlockKind) => void) | undefined;
  onExpand?: (() => void) | undefined;
  onCollapse?: (() => void) | undefined;
  onChooseDay?: ((day: number, kind: BlockKind) => void) | undefined;
  onOpenDay?: ((day: number) => void) | undefined;
  onPaintDay?: ((day: number, cells: boolean[]) => void) | undefined;
  onSheetDone?: (() => void) | undefined;
  onBackToChoice?: (() => void) | undefined;
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
  sendHint,
  organiserName = null,
  onSeeOptions,
  single = false,
  onPaintDays,
  guide,
  guideRoom,
  closes,
  zoneNote,
  grid = [],
  weekdays = [],
  block,
  expanded = false,
  rows = [],
  singleHeading = '',
  sheetRow,
  backTo,
  flexible = false,
  changed = false,
  usual,
  filledFromUsual = false,
  problem,
  reference,
  busy = false,
  onUseUsual,
  onUndoUsual,
  onTick,
  onChooseWindow,
  onExpand,
  onCollapse,
  onChooseDay,
  onOpenDay,
  onPaintDay,
  onSheetDone,
  onBackToChoice,
  onFlexible,
  onSend,
  onNoneOfTheseDates,
  onRetry,
  onBack,
}: AvailabilityProps) {
  const loading = useLoadingHold(state === 'loading');
  // Send was pressed before it could do anything: say why, once, until a day is tapped.
  const [asked, setAsked] = useState(false);
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
      <LoadFailed
        state={state}
        message={t('availability', state === 'offline' ? 'youre_offline' : 'couldnt_load')}
        where="guest"
        topTitle={title}
        onBack={onBack}
        onRetry={onRetry}
      />
    );
  }

  if (state === 'expired') {
    return (
      <Screen>
        <TopBar title={title} onBack={onBack} backLabel={t('common', 'back')} />
        <Body>
          <Stack>
            <DisplayL>{t('availability', 'replies_closed')}</DisplayL>
            <BodyText>
              {organiserName === null
                ? t('availability', 'replies_closed_body')
                : t('availability', 'replies_closed_body_named', { name: organiserName })}
            </BodyText>
          </Stack>
        </Body>
        <Foot>
          {onSeeOptions === undefined ? (
            <Tertiary label={t('availability', 'back')} onPress={onBack} />
          ) : (
            <Button label={t('availability', 'see_how_its_looking')} onPress={onSeeOptions} />
          )}
        </Foot>
      </Screen>
    );
  }

  const canSend = flexible || block !== undefined;
  if (canSend && asked) setAsked(false);
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
          {guide === undefined ? null : guideRoom === undefined ? (
            <BodyText>{guide}</BodyText>
          ) : (
            <View>
              <View
                style={styles.room}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                aria-hidden
              >
                <BodyText>{guideRoom}</BodyText>
              </View>
              <View style={styles.over}>
                <BodyText>{guide}</BodyText>
              </View>
            </View>
          )}
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
        {usual === undefined ? null : (
          <Stack gap={6}>
            <View style={styles.offer}>
              <CompactButton
                tone="plain"
                icon="undo"
                label={t('availability', 'usual_button')}
                disabled={locked}
                onPress={onUseUsual}
              />
            </View>
            <Small>{usual.says}</Small>
          </Stack>
        )}
        {block === undefined ? null : (
          <View style={dimmed && styles.dimmed}>
            <Stack gap={12}>
              <AnswerBlock
                block={block}
                single={single}
                singleHeading={singleHeading}
                expanded={expanded}
                rows={rows}
                locked={locked || flexible}
                onChoose={onChooseWindow}
                onExpand={onExpand}
                onCollapse={onCollapse}
                onChooseDay={onChooseDay}
                onOpenDay={onOpenDay}
              />
              {filledFromUsual ? (
                <Row gap={4}>
                  <Small>{t('availability', 'usual_filled')}</Small>
                  <Tertiary
                    label={t('availability', 'usual_undo')}
                    aria-label={t('availability', 'usual_undo_for')}
                    onPress={locked ? undefined : onUndoUsual}
                  />
                </Row>
              ) : null}
            </Stack>
          </View>
        )}
        <Row>
          {/* Shrinks, so the switch keeps its place inside the gutter at 360 (SUS-250). */}
          <View style={styles.easy}>
            <Stack>
              <Title>{t('availability', 'im_easy')}</Title>
              <Small>{t('availability', 'count_me_in_for_whatever_works_for')}</Small>
            </Stack>
          </View>
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
        {!canSend && asked && sendHint !== undefined ? (
          <Small accessibilityRole="alert" style={styles.hint}>
            {sendHint}
          </Small>
        ) : null}
        <Button
          label={t('availability', 'send_my_times')}
          busyLabel={t('availability', 'sending')}
          busy={busy}
          waiting={!canSend}
          onPress={canSend ? onSend : () => setAsked(true)}
        />
        <Tertiary
          tone="plain"
          label={noneLabel ?? t('availability', 'none_of_these_dates_work_for_me')}
          onPress={locked ? undefined : onNoneOfTheseDates}
        />
      </Foot>
      <DayHoursSheet
        row={sheetRow}
        busy={locked}
        backTo={backTo}
        onPaint={onPaintDay}
        onDone={onSheetDone}
        onBack={onBackToChoice}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  dimmed: { opacity: 0.45 },
  room: { opacity: 0 },
  over: { position: 'absolute', top: 0, left: 0, right: 0 },
  offer: { alignSelf: 'flex-start' },
  easy: { flex: 1 },
  hint: { textAlign: 'center' },
});
