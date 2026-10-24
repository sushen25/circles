import { Platform, Pressable, Text as RNText } from 'react-native';

import {
  Arrive,
  Body,
  BodyText,
  Button,
  Card,
  DateText,
  DisplayXL,
  Foot,
  usePalette,
  Marks,
  Notice,
  Screen,
  Small,
  Tertiary,
  Title,
  TopBar,
  useLoadingHold,
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
/** `plain` is the one that lets go ("I can't make it"), the quieter tone (manifesto §5.4). */
export type AttendanceAction = { label: string; onPress: () => void; tone?: 'plain' };

export type ConfirmedGuestProps = {
  state?: ConfirmedState | undefined;
  view?: ConfirmedView | undefined;
  /** Absent when there is no place to find. A real link on the web, opened by the app elsewhere. */
  mapsHref?: string | undefined;
  onOpenMaps?: (() => void) | undefined;
  /** The reader said they are going: only they are told "Thursday it is. See you then." */
  going?: boolean | undefined;
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
  mapsHref,
  onOpenMaps,
  going = false,
  mine,
  actions = [],
  busy = false,
  notice,
  onAddToCalendar,
  onRetry,
  onBack,
}: ConfirmedGuestProps) {
  const loading = useLoadingHold(state === 'loading');
  if (loading || state !== 'default' || view === undefined) {
    return (
      <ConfirmedPlaceholder
        state={loading ? 'loading' : state}
        where="guest"
        onRetry={onRetry}
        onBack={onBack}
      />
    );
  }

  const deciding = mine !== undefined && !going && actions.length > 0;

  return (
    <Screen invert>
      <TopBar title={view.circleName} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Arrive>
          <Stack>
            <DisplayXL>{view.weekday}</DisplayXL>
            <DateText>{view.dayMonth}</DateText>
            {/* The state is the line under the heading, not a label above it. */}
            <BodyText>{view.stateLine}</BodyText>
            {view.zoneNote === undefined ? null : <Small>{view.zoneNote}</Small>}
          </Stack>
        </Arrive>
        {view.placeName === undefined && onOpenMaps === undefined ? null : (
          <Stack>
            {view.placeName === undefined ? null : <Title>{view.placeName}</Title>}
            {onOpenMaps === undefined && mapsHref === undefined ? null : (
              <MapsLink href={mapsHref} onPress={onOpenMaps} />
            )}
          </Stack>
        )}
        <Card>
          <Stack gap={8}>
            <Title>{view.counts}</Title>
            <Small>{view.guestNames}</Small>
            <Marks members={view.members} max={MARKS_MAX} label={view.guestNames} />
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
        {going ? (
          <Stack gap={2}>
            <Title>{t('confirmedOrg', 'it_is', { weekday: view.weekday })}</Title>
            <BodyText>{t('confirmedOrg', 'see_you_then')}</BodyText>
          </Stack>
        ) : null}
      </Body>
      <Foot>
        {/*
          Somebody who has not said they are going is asked to, as the screen's one decision
          (SUS-250); Add to calendar is for somebody who is. A reader who was never asked has
          nothing to decide, so it stays theirs.
        */}
        {deciding ? (
          <Button
            label={actions[0]!.label}
            busyLabel={t('confirmedGuest', 'saving')}
            busy={busy}
            onPress={actions[0]!.onPress}
          />
        ) : (
          <Button label={t('confirmedGuest', 'add_to_calendar')} onPress={onAddToCalendar} />
        )}
        {(deciding ? actions.slice(1) : actions).map((action) => (
          <Tertiary
            key={action.label}
            label={action.label}
            tone={action.tone}
            busyLabel={t('confirmedGuest', 'saving')}
            busy={busy}
            onPress={action.onPress}
          />
        ))}
      </Foot>
    </Screen>
  );
}

/**
 * "Open in Maps": a link, so it opens in a new tab, can be long-pressed and
 * copied, and is read as a link (SUS-250). A 44 pt target, as the manifesto
 * asks, with the words underlined like the sentence's own links.
 */
function MapsLink({
  href,
  onPress,
}: {
  href: string | undefined;
  onPress: (() => void) | undefined;
}) {
  const palette = usePalette();
  return (
    <Pressable
      role="link"
      aria-label={t('confirmedGuest', 'open_in_maps')}
      // On the web the anchor does the opening; elsewhere the app does.
      onPress={Platform.OS === 'web' && href !== undefined ? undefined : onPress}
      style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}
      {...(href === undefined
        ? {}
        : ({ href, hrefAttrs: { target: '_blank', rel: 'noreferrer' } } as object))}
    >
      <RNText style={{ color: palette.ink, textDecorationLine: 'underline' }}>
        {t('confirmedGuest', 'open_in_maps')}
      </RNText>
    </Pressable>
  );
}
