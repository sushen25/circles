import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { t } from '../../copy';
import { useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import {
  circleKeys,
  mySwitchesEverywhere,
  saveMySwitches,
  type CircleSwitches,
  type SwitchPatch,
} from '../../data/circles';
import { isOffline } from '../identity/join/failure';
import { useSavedPlace } from '../identity/useSavedPlace';
import {
  NotificationSettingsScreen,
  type CircleNotificationRow,
  type NotificationSwitch,
} from './NotificationSettingsScreen';

/**
 * `/settings/notifications` (spec §5.8): the reader's three switches in every
 * circle they are in, each stored on their own membership — `muted_all`,
 * `muted_quiet_asks`, `muted_nudges` — and quiet hours, which are fixed.
 *
 * A switch moves at once and is saved behind it; a save that fails puts it
 * back and says so, rather than leaving a switch that lies.
 */
export function NotificationSettingsFlow() {
  return hasBackend() ? <LiveNotifications /> : <FixtureNotifications />;
}

const FIELD: Record<NotificationSwitch, keyof SwitchPatch> = {
  all: 'mutedAll',
  quietAsks: 'mutedQuietAsks',
  nudges: 'mutedNudges',
};

function rowOf(circle: CircleSwitches): CircleNotificationRow {
  return {
    circleId: circle.circleId,
    circleName: circle.circleName,
    allOn: !circle.mutedAll,
    quietAsksOn: !circle.mutedQuietAsks,
    nudgesOn: !circle.mutedNudges,
  };
}

function flip(row: CircleNotificationRow, which: NotificationSwitch, on: boolean) {
  return {
    ...row,
    ...(which === 'all'
      ? { allOn: on }
      : which === 'quietAsks'
        ? { quietAsksOn: on }
        : { nudgesOn: on }),
  };
}

function FixtureNotifications() {
  const router = useRouter();
  const [rows, setRows] = useState<CircleNotificationRow[]>([
    {
      circleId: 'sunday-crew',
      circleName: t('notificationSettings', 'sunday_crew'),
      allOn: true,
      quietAsksOn: true,
      nudgesOn: true,
    },
  ]);
  const [quietHours, setQuietHours] = useState(false);
  return (
    <NotificationSettingsScreen
      circles={rows}
      quietHoursOpen={quietHours}
      onToggle={(circleId, which, on) =>
        setRows((all) => all.map((row) => (row.circleId === circleId ? flip(row, which, on) : row)))
      }
      onQuietHours={() => setQuietHours(true)}
      onCloseQuietHours={() => setQuietHours(false)}
      onBack={() => router.back()}
    />
  );
}

function LiveNotifications() {
  const router = useRouter();
  const session = useSession();
  const queryClient = useQueryClient();
  const gate = useSavedPlace();
  const key = circleKeys.switches(session.userId);
  const switches = useQuery({
    queryKey: key,
    queryFn: mySwitchesEverywhere,
    enabled: gate === 'allow',
    staleTime: 0,
  });
  const [problem, setProblem] = useState<string | undefined>();
  const [quietHours, setQuietHours] = useState(false);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/settings/account'));

  if (gate === 'wait' || switches.isPending) {
    return <NotificationSettingsScreen state="loading" onBack={back} />;
  }
  if (switches.isError) {
    return (
      <NotificationSettingsScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => void switches.refetch()}
        onBack={back}
      />
    );
  }

  const toggle = (circleId: string, which: NotificationSwitch, on: boolean) => {
    setProblem(undefined);
    const field = FIELD[which];
    const before = queryClient.getQueryData<CircleSwitches[]>(key);
    queryClient.setQueryData<CircleSwitches[]>(key, (all) =>
      all?.map((c) => (c.circleId === circleId ? { ...c, [field]: !on } : c)),
    );
    void saveMySwitches(circleId, { [field]: !on })
      .then(() => queryClient.invalidateQueries({ queryKey: ['circle-home', circleId] }))
      .catch(() => {
        queryClient.setQueryData(key, before);
        setProblem(
          isOffline()
            ? t('notificationSettings', 'youre_offline')
            : t('notificationSettings', 'couldnt_save'),
        );
      });
  };

  return (
    <NotificationSettingsScreen
      circles={switches.data.map(rowOf)}
      problem={problem}
      quietHoursOpen={quietHours}
      onToggle={toggle}
      onQuietHours={() => setQuietHours(true)}
      onCloseQuietHours={() => setQuietHours(false)}
      onBack={back}
    />
  );
}
