import type { CircleId, PlanId } from '@circles/contracts';
import { Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { hasBackend } from '../../data/auth/client';
import type { PlanConfirmation } from '../../data/confirmation';
import { appOrigin } from '../../data/links/origin';
import { mapsLink } from '../../platform/maps';
import { shareMessage } from '../../platform/share';
import { isOffline } from '../identity/join/failure';
import { dateOf } from '../scheduling/words';
import { AddToCalendarSheet } from './AddToCalendarScreen';
import { ConfirmedGuestScreen, type AttendanceAction } from './ConfirmedGuestScreen';
import { ConfirmedOrgScreen } from './ConfirmedOrgScreen';
import {
  calendarFilename,
  confirmedOf,
  messageOf,
  myAttendanceOf,
  type LockedIn,
} from './confirmed';
import * as fixture from './fixtures';
import { useAttendance } from './useAttendance';
import { useCalendar } from './useCalendar';
import { useConfirmation } from './useConfirmation';

/**
 * The confirmed meetup, on either door (spec §5.7):
 *
 * - `/circles/:id/plan/:planId/confirmed` — circle home's `locked_in` state
 *   links here (S1-23), and so do the options once a time is locked in;
 * - `/p/:code/confirmed` — the plan's own link, from the group chat or an
 *   email.
 *
 * **Who you are decides the screen, not the door.** The organiser gets the
 * message to paste and the ways to change the plan; everybody else gets where
 * to go and their own answer. Only the organiser holds a decision here, and the
 * read — not the route — says who that is.
 *
 * `calendar` opens the add-to-calendar sheet over it, which is what
 * `/p/:code/calendar` is.
 */
export type ConfirmedKey = { planId: string } | { code: string };

export function ConfirmedFlow({
  target,
  calendar = false,
  fixtureAs = 'organiser',
}: {
  target: ConfirmedKey;
  calendar?: boolean | undefined;
  /** With no backend: whose screen the fixture shows. */
  fixtureAs?: 'organiser' | 'member' | undefined;
}) {
  if (!hasBackend()) {
    const data = fixtureAs === 'member' ? fixture.lockedInAsMember : fixture.lockedIn;
    return <Confirmed data={data} confirmation={data.confirmation!} calendar={calendar} />;
  }
  return <LiveConfirmed target={target} calendar={calendar} />;
}

function LiveConfirmed({ target, calendar }: { target: ConfirmedKey; calendar: boolean }) {
  const router = useRouter();
  const query = useConfirmation(target);
  const data = query.data ?? undefined;

  // Not locked in (never, or reopened by "Change the time"): the options are
  // the screen to be on. Once, guarded by a ref — `useRouter` can hand back a
  // new object per render, and a `replace` that re-runs on it is a loop.
  const sent = useRef(false);
  const open = data?.view === 'open' ? data : undefined;
  useEffect(() => {
    if (open === undefined || sent.current) return;
    sent.current = true;
    if (open.isOrganiser) {
      router.replace({
        pathname: '/circles/[id]/plan/[planId]/candidates',
        params: { id: open.circleId, planId: open.planId },
      });
    } else {
      router.replace({ pathname: '/p/[code]', params: { code: open.code } });
    }
  }, [open, router]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (query.isPending || open !== undefined) {
    return <ConfirmedOrgScreen state="loading" onBack={back} />;
  }
  if (query.isError) {
    return (
      <ConfirmedOrgScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => void query.refetch()}
        onBack={back}
      />
    );
  }
  if (data === undefined) return <ConfirmedOrgScreen state="denied" onBack={back} />;
  if (data.view !== 'confirmed' || data.confirmation === null) {
    return <ConfirmedOrgScreen state="expired" onBack={back} />;
  }
  return (
    <Confirmed
      data={data}
      confirmation={data.confirmation}
      calendar={calendar}
      queryKey={'planId' in target ? target.planId : target.code}
    />
  );
}

function Confirmed({
  data,
  confirmation,
  calendar: openCalendar,
  queryKey = '',
}: {
  data: PlanConfirmation;
  confirmation: LockedIn;
  calendar: boolean;
  queryKey?: string;
}) {
  const router = useRouter();
  const view = confirmedOf(data, confirmation);
  const ids = { circle_id: data.circleId as CircleId, plan_id: data.planId as PlanId };
  const calendar = useCalendar({
    circleId: data.circleId,
    planId: data.planId,
    confirmationId: confirmation.id,
    filename: calendarFilename(data, confirmation),
  });
  const attendance = useAttendance(
    data.me === undefined
      ? undefined
      : {
          circleId: data.circleId,
          planId: data.planId,
          confirmationId: confirmation.id,
          me: data.me,
        },
    queryKey,
  );
  const [shareNotice, setShareNotice] = useState<string>();

  // `/p/:code/calendar`: the sheet is open on arrival, and counts as opened.
  const opened = useRef(false);
  const { show } = calendar;
  useEffect(() => {
    if (!openCalendar || opened.current) return;
    opened.current = true;
    show();
  }, [openCalendar, show]);

  const toCircle = () =>
    router.canGoBack()
      ? router.back()
      : router.replace({ pathname: '/circles/[id]', params: { id: data.circleId } });

  const day = dateOf(confirmation.startsAt, data.zone);
  const sheet = (
    <AddToCalendarSheet
      visible={calendar.open}
      title={t('addToCalendar', 'title', { day: view.weekday })}
      detail={
        view.placeName === undefined
          ? t('addToCalendar', 'detail', { day, time: view.time })
          : t('addToCalendar', 'detail_place', { day, time: view.time, what: view.placeName })
      }
      busy={calendar.busy}
      status={calendar.status}
      onDevice={calendar.download}
      onDismiss={calendar.hide}
    />
  );

  if (data.isOrganiser) {
    const message = messageOf(data, confirmation, appOrigin());
    return (
      <>
        <ConfirmedOrgScreen
          view={view}
          message={message}
          shareNotice={shareNotice}
          onShare={() => {
            setShareNotice(undefined);
            void shareMessage(message).then((result) => {
              // The sheet opened, not that a message was sent (§5.8).
              if (result === 'sheet' || result === 'dismissed' || result === 'copied') {
                track('share_opened', { ...ids, kind: 'confirmed' });
              }
              if (result === 'copied') setShareNotice(t('confirmedOrg', 'copied'));
              if (result === 'failed') setShareNotice(t('confirmedOrg', 'share_failed'));
            });
          }}
          onAddToCalendar={calendar.show}
          onChangeTime={() =>
            router.push({
              pathname: '/circles/[id]/plan/[planId]/change-time',
              params: { id: data.circleId, planId: data.planId },
            })
          }
          onCancelPlan={() =>
            router.push({
              pathname: '/circles/[id]/plan/[planId]/cancel',
              params: { id: data.circleId, planId: data.planId },
            })
          }
          onBack={toCircle}
        />
        {sheet}
      </>
    );
  }

  const mine = myAttendanceOf(data, confirmation, new Date());
  const actions: AttendanceAction[] = [];
  if (mine?.canGo === true) {
    actions.push({
      label: t('confirmedGuest', 'i_can_make_it'),
      onPress: () => attendance.change('going'),
    });
  }
  if (mine?.canCant === true) {
    actions.push({
      label:
        mine.status === 'going'
          ? t('confirmedGuest', 'i_cant_make_it_after_all')
          : t('confirmedGuest', 'i_cant_make_it'),
      onPress: () => attendance.change('cant'),
    });
  }
  const maps = mapsLink({ name: confirmation.placeName, url: confirmation.placeUrl });

  return (
    <>
      <ConfirmedGuestScreen
        view={view}
        onOpenMaps={maps === undefined ? undefined : () => void Linking.openURL(maps)}
        mine={
          mine === undefined
            ? undefined
            : mine.status === 'going'
              ? {
                  title: t('confirmedGuest', 'youre_going'),
                  detail: t('confirmedGuest', 'tap_below_if_that_changes'),
                }
              : mine.status === 'cant'
                ? {
                    title: t('confirmedGuest', 'you_cant'),
                    detail: t('confirmedGuest', 'tap_below_if_that_changes'),
                  }
                : {
                    title: t('confirmedGuest', 'you_unsaid'),
                    detail: t('confirmedGuest', 'say_below'),
                  }
        }
        actions={actions}
        busy={attendance.busy}
        notice={attendance.problem}
        onAddToCalendar={calendar.show}
        onBack={toCircle}
      />
      {sheet}
    </>
  );
}
