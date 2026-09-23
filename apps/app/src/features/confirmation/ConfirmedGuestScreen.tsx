import {
  Body,
  BodyText,
  Button,
  Card,
  DateText,
  DisplayXL,
  Foot,
  InlineLink,
  Label,
  Marks,
  Notice,
  Screen,
  Small,
  Tertiary,
  Title,
  TopBar,
} from '../../components';
import { Divider, Stack } from '../../components/layout';
import { t } from '../../copy';
import { MARKS_MAX } from '../scheduling/parts';
import type { ConfirmedView } from './confirmed';
import { ConfirmedPlaceholder, type ConfirmedState } from './parts';

/**
 * ConfirmedGuest — `docs/design/ConfirmedGuest.dc.html` (spec §5.7).
 *
 * What a member needs from a plan that is real: when, where and how to get
 * there, who else is coming, and their own answer — which they may change
 * either way until it happens ("Tap below if that changes"). Inverted, like the
 * organiser's: this is the outcome, and it is allowed to feel like one
 * (manifesto §3.7).
 *
 * Presentational. The flow owns the write, the maps link and the sheet.
 */
export type AttendanceAction = { label: string; onPress: () => void };

export type ConfirmedGuestProps = {
  state?: ConfirmedState | undefined;
  view?: ConfirmedView | undefined;
  /** Absent when there is no place to find. */
  onOpenMaps?: (() => void) | undefined;
  /** "You're going" — absent for somebody who was never asked. */
  mine?: { title: string; detail: string } | undefined;
  actions?: readonly AttendanceAction[] | undefined;
  busy?: boolean | undefined;
  notice?: string | undefined;
  onAddToCalendar?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function ConfirmedGuestScreen({
  state = 'default',
  view,
  onOpenMaps,
  mine,
  actions = [],
  busy = false,
  notice,
  onAddToCalendar,
  onRetry,
  onBack,
}: ConfirmedGuestProps) {
  if (state !== 'default' || view === undefined) {
    return <ConfirmedPlaceholder state={state} onRetry={onRetry} onBack={onBack} />;
  }

  return (
    <Screen invert>
      <TopBar title={view.circleName} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Label>{t('confirmedGuest', 'locked_in')}</Label>
        <Stack>
          <DisplayXL>{view.weekday}</DisplayXL>
          <DateText>{view.dayMonth}</DateText>
          <BodyText>{view.time}</BodyText>
        </Stack>
        {view.placeName === undefined && onOpenMaps === undefined ? null : (
          <Stack>
            {view.placeName === undefined ? null : <Title>{view.placeName}</Title>}
            {onOpenMaps === undefined ? null : (
              <BodyText>
                <InlineLink onPress={onOpenMaps}>{t('confirmedGuest', 'open_in_maps')}</InlineLink>
              </BodyText>
            )}
          </Stack>
        )}
        <Card>
          <Stack gap={8}>
            <Title>{view.counts}</Title>
            <Small>{view.names}</Small>
            <Marks members={view.members} max={MARKS_MAX} label={view.names} />
          </Stack>
          {mine === undefined ? null : (
            <>
              <Divider />
              <Stack>
                <Title accessibilityLiveRegion="polite">{mine.title}</Title>
                <Small>{mine.detail}</Small>
              </Stack>
            </>
          )}
        </Card>
        {notice === undefined ? null : <Notice kind="warn">{notice}</Notice>}
        {view.note === undefined ? null : <BodyText>{view.note}</BodyText>}
      </Body>
      <Foot>
        <Button label={t('confirmedGuest', 'add_to_calendar')} onPress={onAddToCalendar} />
        {actions.map((action) => (
          <Tertiary
            key={action.label}
            label={busy ? t('confirmedGuest', 'saving') : action.label}
            disabled={busy}
            onPress={action.onPress}
          />
        ))}
      </Foot>
    </Screen>
  );
}
