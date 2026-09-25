import {
  Body,
  BodyText,
  Button,
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
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import { AnswerList } from './AnswerList';
import type { BlockKind } from './blocks';
import { DayPicker } from './DayPicker';
import type { AnswerView, PanelView } from './view';

/**
 * Availability — `docs/design/Availability.dc.html` (spec §5.5, ADR 0024).
 *
 * Presentational: every string arrives worked out (`view.ts`) and every change
 * leaves as a callback, so the gallery can show each state and the container
 * (`Answering`) owns the plan, the draft and the network. Days first, then a
 * time once for all of them; the answer is listed in words, and a line opens to
 * adjust that day by the half hour. Nothing here is said by colour alone.
 */

export type AvailabilityState = 'default' | 'loading' | 'error' | 'offline' | 'expired';

export type AvailabilityProps = {
  state?: AvailabilityState | undefined;
  /** "Catch up · 14–27 Sep" */
  title?: string | undefined;
  /** "3 of 14 days" */
  count?: string | undefined;
  /** "Catch-ups run about 2 hours. Replies close Tue 15 Sep, 6 pm." */
  intro?: string | undefined;
  /** "Times are Melbourne time.", when the device is somewhere else. */
  zoneNote?: string | undefined;
  grid?: readonly GridDay[] | undefined;
  weekdays?: readonly string[] | undefined;
  /** The card under the grid; undefined while no day is ticked. */
  panel?: PanelView | undefined;
  answers?: readonly AnswerView[] | undefined;
  /** "Start over" has just cleared the answer. */
  canUndo?: boolean | undefined;
  flexible?: boolean | undefined;
  /** The plan changed under a draft (the rescheduled state). */
  changed?: boolean | undefined;
  problem?: string | undefined;
  reference?: string | undefined;
  busy?: boolean | undefined;
  onTick?: ((day: number) => void) | undefined;
  onDone?: (() => void) | undefined;
  onBlock?: ((kind: BlockKind) => void) | undefined;
  onClearTicked?: (() => void) | undefined;
  onOpen?: ((day: number) => void) | undefined;
  onPaint?: ((day: number, cells: boolean[]) => void) | undefined;
  onWholeDay?: ((day: number) => void) | undefined;
  onRemoveDay?: ((day: number) => void) | undefined;
  onStartOver?: (() => void) | undefined;
  onUndo?: (() => void) | undefined;
  onFlexible?: ((on: boolean) => void) | undefined;
  /** "Use my usual times", when there is a usual and nothing painted yet (ADR 0005). */
  onUseUsual?: (() => void) | undefined;
  onSend?: (() => void) | undefined;
  onNoneOfTheseDates?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function AvailabilityScreen({
  state = 'default',
  title,
  count,
  intro,
  zoneNote,
  grid = [],
  weekdays = [],
  panel,
  answers = [],
  canUndo = false,
  flexible = false,
  changed = false,
  problem,
  reference,
  busy = false,
  onTick,
  onDone,
  onBlock,
  onClearTicked,
  onOpen,
  onPaint,
  onWholeDay,
  onRemoveDay,
  onStartOver,
  onUndo,
  onFlexible,
  onUseUsual,
  onSend,
  onNoneOfTheseDates,
  onRetry,
  onBack,
}: AvailabilityProps) {
  if (state === 'loading') {
    return (
      <Screen>
        <TopBar onBack={onBack} backLabel={t('common', 'back')} />
        <Body>
          <Small accessibilityLiveRegion="polite">{t('availability', 'finding_the_plan')}</Small>
        </Body>
      </Screen>
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

  const canSend = flexible || answers.some((answer) => answer.cells.some(Boolean));
  // While an answer is on its way nothing that would change it is live: the
  // request carries the answer as it was when Send was pressed.
  const locked = busy;
  const dimmed = flexible || locked;

  return (
    <Screen>
      <TopBar
        title={title}
        onBack={onBack}
        backLabel={t('common', 'back')}
        right={count === undefined ? undefined : <Small>{count}</Small>}
      />
      <Body>
        <Stack>
          <DisplayL>{t('availability', 'times_id_actually_be_up_for')}</DisplayL>
          {intro === undefined ? null : <BodyText>{intro}</BodyText>}
          {zoneNote === undefined ? null : <Small>{zoneNote}</Small>}
        </Stack>
        {changed ? <Notice kind="warn">{t('availability', 'plan_changed')}</Notice> : null}
        {onUseUsual === undefined || dimmed ? null : (
          <Tertiary
            label={t('availability', 'use_my_usual_times')}
            accessibilityHint={t('availability', 'use_my_usual_times_hint')}
            onPress={onUseUsual}
          />
        )}
        <DayPicker
          grid={grid}
          weekdays={weekdays}
          panel={panel}
          dimmed={dimmed}
          onTick={onTick}
          onDone={onDone}
          onBlock={onBlock}
          onClearTicked={onClearTicked}
        />
        <AnswerList
          answers={answers}
          canUndo={canUndo}
          dimmed={dimmed}
          onOpen={onOpen}
          onPaint={onPaint}
          onWholeDay={onWholeDay}
          onRemoveDay={onRemoveDay}
          onStartOver={onStartOver}
          onUndo={onUndo}
        />
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
        <Notice>{t('availability', 'your_friends_will_only_see_a_combined')}</Notice>
        {problem === undefined ? null : <Notice kind="warn">{problem}</Notice>}
        {reference === undefined ? null : (
          <Small>{t('availability', 'reference', { reference })}</Small>
        )}
      </Body>
      <Foot>
        {canSend ? null : <Small>{t('availability', 'pick_or_easy')}</Small>}
        <Button
          label={busy ? t('availability', 'sending') : t('availability', 'send_my_times')}
          onPress={onSend}
          disabled={busy || !canSend}
        />
        <Tertiary
          label={t('availability', 'none_of_these_dates_work_for_me')}
          onPress={locked ? undefined : onNoneOfTheseDates}
        />
      </Foot>
    </Screen>
  );
}
