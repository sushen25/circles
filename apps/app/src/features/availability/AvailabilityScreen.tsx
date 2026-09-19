import type { ShortcutKind } from '@circles/domain';

import {
  Body,
  BodyText,
  Button,
  Chip,
  Chips,
  DisplayL,
  Foot,
  Notice,
  Screen,
  Small,
  Tertiary,
  Title,
  Toggle,
  TopBar,
  Track,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Mark } from './days';

/**
 * Availability — `docs/design/Availability.dc.html` (spec §5.5).
 *
 * Presentational: every string arrives worked out and every change leaves as a
 * callback, so the gallery can show each state and the container
 * (`AvailabilityFlow`) owns the plan, the draft and the network. The fill is
 * the affordance and the range beside each date is the answer (manifesto
 * §5.4); nothing here is said by colour alone.
 */

export type DayView = {
  key: string;
  /** "Mon 14 Sep" */
  short: string;
  /** "Monday 14 September" — the row's group label. */
  spoken: string;
  cells: boolean[];
  labels: string[];
  marks: Mark[];
  /** "6:30–10:30 pm", or "Not this day". */
  range: string;
  /** Every cell painted: the row's tertiary then clears it. */
  wholeDay: boolean;
};

export type ShortcutView = { kind: ShortcutKind; label: string; on: boolean };

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
  shortcuts?: readonly ShortcutView[] | undefined;
  days?: readonly DayView[] | undefined;
  flexible?: boolean | undefined;
  /** The plan changed under a draft (the rescheduled state). */
  changed?: boolean | undefined;
  problem?: string | undefined;
  reference?: string | undefined;
  busy?: boolean | undefined;
  onPaint?: ((day: number, cells: boolean[]) => void) | undefined;
  onShortcut?: ((kind: ShortcutKind) => void) | undefined;
  onWholeDay?: ((day: number) => void) | undefined;
  onFlexible?: ((on: boolean) => void) | undefined;
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
  shortcuts = [],
  days = [],
  flexible = false,
  changed = false,
  problem,
  reference,
  busy = false,
  onPaint,
  onShortcut,
  onWholeDay,
  onFlexible,
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

  const canSend = flexible || days.some((day) => day.cells.some(Boolean));

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
        {shortcuts.length === 0 ? null : (
          <Chips>
            {shortcuts.map((shortcut) => (
              <Chip
                key={shortcut.kind}
                label={shortcut.label}
                selected={shortcut.on}
                onPress={flexible ? undefined : () => onShortcut?.(shortcut.kind)}
              />
            ))}
          </Chips>
        )}
        {days.map((day, index) => (
          <Track
            key={day.key}
            day={day.short}
            groupLabel={day.spoken}
            cells={day.cells}
            onChange={(cells) => onPaint?.(index, cells)}
            startMinutes={0}
            labels={day.labels}
            range={day.range}
            marks={day.marks}
            dimmed={flexible}
            footer={
              flexible ? null : (
                <Tertiary
                  label={
                    day.wholeDay
                      ? t('availability', 'clear_this_day')
                      : t('availability', 'any_time_that_day')
                  }
                  // Fourteen of these read alike; the name says which day.
                  aria-label={
                    day.wholeDay
                      ? t('availability', 'clear_day', { day: day.spoken })
                      : t('availability', 'any_time_on', { day: day.spoken })
                  }
                  onPress={() => onWholeDay?.(index)}
                />
              )
            }
          />
        ))}
        <Row>
          <Stack>
            <Title>{t('availability', 'im_easy')}</Title>
            <Small>{t('availability', 'count_me_in_for_whatever_works_for')}</Small>
          </Stack>
          <Toggle
            value={flexible}
            onValueChange={(on) => onFlexible?.(on)}
            label={t('availability', 'im_easy')}
          />
        </Row>
        <Notice>{t('availability', 'your_friends_will_only_see_a_combined')}</Notice>
        {problem === undefined ? null : <Notice kind="warn">{problem}</Notice>}
        {reference === undefined ? null : (
          <Small>{t('availability', 'reference', { reference })}</Small>
        )}
      </Body>
      <Foot>
        {canSend ? null : <Small>{t('availability', 'paint_or_easy')}</Small>}
        <Button
          label={busy ? t('availability', 'sending') : t('availability', 'send_my_times')}
          onPress={onSend}
          disabled={busy || !canSend}
        />
        <Tertiary
          label={t('availability', 'none_of_these_dates_work_for_me')}
          onPress={onNoneOfTheseDates}
        />
      </Foot>
    </Screen>
  );
}
