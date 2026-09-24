import {
  Body,
  BodyText,
  Button,
  ButtonRow,
  Card,
  DateText,
  DisplayXL,
  Foot,
  Label,
  Marks,
  Notice,
  Screen,
  Small,
  Tertiary,
  Title,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import { MARKS_MAX } from '../scheduling/parts';
import type { AttendanceAction } from './ConfirmedGuestScreen';
import { ConfirmedPlaceholder, type ConfirmedState } from './parts';
import type { ConfirmedView } from './confirmed';

/**
 * ConfirmedOrg — `docs/design/ConfirmedOrg.dc.html` (spec §5.7, manifesto §3.7).
 *
 * The only screen that inverts to the dark ground: the moment a plan becomes
 * real. What the organiser needs next is the message for the group chat, so it
 * is on the screen whole — the same text the share sheet gets — with who is
 * coming and who has still to say under it.
 *
 * Presentational. The words come from `confirmed.ts`; the flow owns sharing,
 * the calendar sheet and navigation.
 */
export type ConfirmedOrgProps = {
  state?: ConfirmedState | undefined;
  view?: ConfirmedView | undefined;
  /** The paste-ready message, exactly as it will be shared. */
  message?: string | undefined;
  /** "Copied. Paste it into the group chat." and the like. */
  shareNotice?: string | undefined;
  /** The organiser's own answer — they are a member too (spec §5.7). */
  mine?: { title: string; detail: string } | undefined;
  actions?: readonly AttendanceAction[] | undefined;
  busy?: boolean | undefined;
  /** Why their own answer did not save. */
  notice?: string | undefined;
  onShare?: (() => void) | undefined;
  onAddToCalendar?: (() => void) | undefined;
  onChangeTime?: (() => void) | undefined;
  onCancelPlan?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function ConfirmedOrgScreen({
  state = 'default',
  view,
  message,
  shareNotice,
  mine,
  actions = [],
  busy = false,
  notice,
  onShare,
  onAddToCalendar,
  onChangeTime,
  onCancelPlan,
  onRetry,
  onBack,
}: ConfirmedOrgProps) {
  if (state !== 'default' || view === undefined) {
    return <ConfirmedPlaceholder state={state} onRetry={onRetry} onBack={onBack} />;
  }

  return (
    <Screen invert>
      <TopBar title={view.circleName} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Label>{t('confirmedOrg', 'locked_in')}</Label>
        <Stack>
          <DisplayXL>{view.weekday}</DisplayXL>
          <DateText>{view.dayMonth}</DateText>
          <BodyText>{view.timePlace}</BodyText>
          {view.zoneNote === undefined ? null : <Small>{view.zoneNote}</Small>}
        </Stack>
        <Card>
          <Label>{t('confirmedOrg', 'ready_to_paste_into_the_group_chat')}</Label>
          <BodyText selectable>{message}</BodyText>
        </Card>
        {shareNotice === undefined ? null : <Notice>{shareNotice}</Notice>}
        <Stack gap={8}>
          <Title>{view.counts}</Title>
          <Marks members={view.members} max={MARKS_MAX} label={view.names} />
          <Small>{view.unsaid}</Small>
        </Stack>
        {mine === undefined ? null : (
          <Stack gap={8}>
            <Title accessibilityLiveRegion="polite">{mine.title}</Title>
            {actions.map((action) => (
              <Tertiary
                key={action.label}
                label={busy ? t('confirmedGuest', 'saving') : action.label}
                disabled={busy}
                onPress={action.onPress}
              />
            ))}
          </Stack>
        )}
        {notice === undefined ? null : <Notice kind="warn">{notice}</Notice>}
      </Body>
      <Foot>
        <Button label={t('confirmedOrg', 'share_to_group_chat')} onPress={onShare} />
        <Button
          label={t('confirmedOrg', 'add_to_my_calendar')}
          variant="secondary"
          onPress={onAddToCalendar}
        />
        {onChangeTime === undefined && onCancelPlan === undefined ? null : (
          <ButtonRow>
            {onChangeTime === undefined ? null : (
              <Tertiary label={t('confirmedOrg', 'change_the_time')} onPress={onChangeTime} />
            )}
            {onCancelPlan === undefined ? null : (
              <Tertiary label={t('confirmedOrg', 'cancel_this_plan')} onPress={onCancelPlan} />
            )}
          </ButtonRow>
        )}
      </Foot>
    </Screen>
  );
}
