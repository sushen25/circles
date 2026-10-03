import { View } from 'react-native';

import {
  Body,
  BodyText,
  Button,
  DayGrid,
  DisplayL,
  Foot,
  Label,
  Marks,
  Notice,
  Screen,
  Small,
  Title,
  TopBar,
  type GridDay,
  type GridPaint,
} from '../../components';
import { Between, Stack } from '../../components/layout';
import { t } from '../../copy';
import { Stepper } from '../planning/parts';
import { MARKS_MAX, Placeholder } from '../scheduling/parts';
import type { StretchView } from './stretch';

/**
 * SetTime — `docs/design/SetTime.dc.html` (spec §5.7, ADR 0050).
 *
 * One day picked at a time, from today, and a start and an end on the half
 * hour; then, live as either changes, who the time works for by name and a
 * caution when one applies. One screen for "Pick a different time", "Set the
 * time yourself" and the edit screen's Change.
 *
 * Presentational. Every string arrives worked out (`stretch.ts`, `time.ts`);
 * the flow owns the reading, the picking and the navigation. The who-it-works-for
 * block is a live region, so a screen reader hears the names change as the time
 * does; the caution is a sentence, never colour alone; and the steppers and the
 * days keep their 44pt targets and spoken labels.
 */
export type SetTimeState = 'default' | 'loading' | 'error' | 'offline' | 'denied' | 'expired';

export type SetTimeCalendar = {
  title: string;
  weekdays: string[];
  days: GridDay[];
  canEarlier: boolean;
  onDay: (index: number) => void;
  onEarlier: () => void;
  onLater: () => void;
  paint?: GridPaint | undefined;
};

export type SetTimeClock = {
  /** "Time on Fri 18 Sep". */
  label: string;
  start: string;
  end: string;
  /** "2 hours, as the plan asked." */
  length: string;
  canStartEarlier: boolean;
  canStartLater: boolean;
  canEndEarlier: boolean;
  canEndLater: boolean;
  onStart: (by: 1 | -1) => void;
  onEnd: (by: 1 | -1) => void;
};

export type SetTimeProps = {
  state?: SetTimeState | undefined;
  /** "Back to options", or "Back to the plan" when it was opened from the edit screen. */
  backTitle?: string | undefined;
  calendar?: SetTimeCalendar | undefined;
  clock?: SetTimeClock | undefined;
  /** Absent while the first answer is on its way. */
  who?: StretchView | undefined;
  /** A newer answer is on its way: the names above are the last ones read. */
  checking?: boolean | undefined;
  problem?: string | undefined;
  /** "Review Friday", or "Use Sat 19 Sep, 7–9 pm" from the edit screen. */
  useLabel?: string | undefined;
  canUse?: boolean | undefined;
  /** For `denied` and `expired`: what to say. */
  message?: string | undefined;
  detail?: string | undefined;
  onUse?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function SetTimeScreen({
  state = 'default',
  backTitle,
  calendar,
  clock,
  who,
  checking = false,
  problem,
  useLabel,
  canUse = false,
  message,
  detail,
  onUse,
  onRetry,
  onBack,
}: SetTimeProps) {
  if (state === 'loading') {
    return <Placeholder topTitle={backTitle} message={t('setTime', 'loading')} onBack={onBack} />;
  }
  if (state === 'error' || state === 'offline') {
    return (
      <Placeholder
        topTitle={backTitle}
        message={state === 'offline' ? t('setTime', 'youre_offline') : t('setTime', 'couldnt_load')}
        actionLabel={t('setTime', 'try_again')}
        onAction={onRetry}
        onBack={onBack}
      />
    );
  }
  if (state === 'denied' || state === 'expired') {
    return (
      <Placeholder
        topTitle={backTitle}
        message={message ?? t('setTime', state === 'denied' ? 'denied_title' : 'over_title')}
        detail={detail ?? t('setTime', state === 'denied' ? 'denied_body' : 'over_body')}
        actionLabel={t('setTime', 'go_to_plan')}
        onAction={onBack}
        onBack={onBack}
      />
    );
  }

  return (
    <Screen>
      <TopBar title={backTitle} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <DisplayL>{t('setTime', 'headline')}</DisplayL>
          <BodyText>{t('setTime', 'lead')}</BodyText>
        </Stack>
        {calendar === undefined ? null : (
          <Stack gap={8}>
            <Between>
              <Label>{calendar.title}</Label>
              <Stepper
                canFewer={calendar.canEarlier}
                canMore
                fewerLabel={t('setTime', 'earlier_month')}
                moreLabel={t('setTime', 'later_month')}
                fewerSpoken={t('setTime', 'earlier_month')}
                moreSpoken={t('setTime', 'later_month')}
                onFewer={calendar.onEarlier}
                onMore={calendar.onLater}
              />
            </Between>
            <Small>{t('setTime', 'others_note')}</Small>
            <DayGrid
              days={calendar.days}
              weekdays={calendar.weekdays}
              label={t('setTime', 'days_label')}
              onToggle={calendar.onDay}
              onPaint={calendar.paint}
            />
          </Stack>
        )}
        {clock === undefined ? null : (
          <Stack gap={8}>
            <Label>{clock.label}</Label>
            <Between>
              <Title>{clock.start}</Title>
              <Stepper
                canFewer={clock.canStartEarlier}
                canMore={clock.canStartLater}
                fewerLabel={t('setTime', 'earlier')}
                moreLabel={t('setTime', 'later')}
                fewerSpoken={t('setTime', 'start_earlier')}
                moreSpoken={t('setTime', 'start_later')}
                onFewer={() => clock.onStart(-1)}
                onMore={() => clock.onStart(1)}
              />
            </Between>
            <Between>
              <Title>{clock.end}</Title>
              <Stepper
                canFewer={clock.canEndEarlier}
                canMore={clock.canEndLater}
                fewerLabel={t('setTime', 'earlier')}
                moreLabel={t('setTime', 'later')}
                fewerSpoken={t('setTime', 'end_earlier')}
                moreSpoken={t('setTime', 'end_later')}
                onFewer={() => clock.onEnd(-1)}
                onMore={() => clock.onEnd(1)}
              />
            </Between>
            <Small>{clock.length}</Small>
          </Stack>
        )}
        <View aria-live="polite" accessibilityLiveRegion="polite">
          <Stack gap={8}>
            <Label>{t('setTime', 'who_label')}</Label>
            {who === undefined ? (
              <Small>{t('setTime', 'checking')}</Small>
            ) : (
              <>
                <Marks members={who.marks} max={MARKS_MAX} label={who.marksLabel} />
                <Title>{who.count}</Title>
                <Small>{checking ? t('setTime', 'checking') : who.line}</Small>
              </>
            )}
          </Stack>
        </View>
        {who?.caution === undefined ? null : <Notice kind="warn">{who.caution}</Notice>}
        {problem === undefined ? null : <Notice kind="warn">{problem}</Notice>}
      </Body>
      <Foot>
        <Button label={useLabel ?? ''} onPress={onUse} disabled={!canUse} />
      </Foot>
    </Screen>
  );
}
