import { isValidDisplayName, normaliseDisplayName } from '@circles/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';

import { t } from '../../copy';
import { ownEmailHint, ownProfile, saveProfile, signOut, useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { AccountScreen } from './AccountScreen';
import { isOffline } from './join/failure';
import { TimeZoneScreen } from './TimeZoneScreen';
import { useSavedPlace } from './useSavedPlace';
import { filterZones, groupZones, supportedZones, zoneLabel } from './zones';

/**
 * `/settings/account` (spec §5.2). Name and time zone are the profile the Your
 * name screen wrote, changed the same way (`saveProfile`, which judges the name
 * by the domain's rule). The address is shown as a hint (`m…@example.com`),
 * never held whole. Signing out goes back to Welcome only once it has
 * happened on this device.
 */
export function AccountFlow() {
  return hasBackend() ? <LiveAccount /> : <FixtureAccount />;
}

function FixtureAccount() {
  const router = useRouter();
  return (
    <AccountScreen
      onPrivacy={() => router.push('/settings/privacy')}
      onNotifications={() => router.push('/settings/notifications')}
      onBack={() => router.back()}
    />
  );
}

function LiveAccount() {
  const router = useRouter();
  const session = useSession();
  const queryClient = useQueryClient();
  const gate = useSavedPlace();
  const profile = useQuery({
    queryKey: ['own-profile', session.userId],
    queryFn: ownProfile,
    enabled: gate === 'allow',
    staleTime: 0,
  });
  const email = useQuery({
    // The hint, never the address: see `ownEmailHint`.
    queryKey: ['own-email-hint', session.userId],
    queryFn: ownEmailHint,
    enabled: gate === 'allow',
  });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [nameProblem, setNameProblem] = useState<string | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');

  const zone = profile.data?.zone ?? 'UTC';
  const groups = useMemo(() => groupZones(supportedZones(), zone), [zone]);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/circles'));

  if (gate === 'wait' || profile.isPending) return <AccountScreen state="loading" onBack={back} />;
  if (profile.isError || profile.data === null) {
    return (
      <AccountScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => void profile.refetch()}
        onBack={back}
      />
    );
  }
  const name = profile.data.name ?? '';

  const save = async (next: { name: string; zone: string }): Promise<boolean> => {
    setBusy(true);
    try {
      await saveProfile(next);
      await queryClient.invalidateQueries({ queryKey: ['own-profile'] });
      // A name follows into every circle (`sync_member_names`), so the homes
      // that show it are stale too.
      await queryClient.invalidateQueries({ queryKey: ['circle-home'] });
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (picking) {
    return (
      <TimeZoneScreen
        groups={filterZones(groups, query)}
        selected={zone}
        query={query}
        onQueryChange={setQuery}
        onPick={(picked) => {
          setPicking(false);
          setQuery('');
          setProblem(undefined);
          void save({ name, zone: picked }).then((saved) => {
            if (!saved) setProblem(t('account', 'couldnt_save'));
          });
        }}
        onBack={() => setPicking(false)}
      />
    );
  }

  return (
    <AccountScreen
      name={name}
      zone={zoneLabel(zone)}
      email={email.data ?? t('account', 'no_email')}
      problem={problem}
      editingName={editing}
      draftName={draft}
      nameProblem={nameProblem}
      busy={busy}
      onChangeName={() => {
        setDraft(name);
        setNameProblem(undefined);
        setEditing(true);
      }}
      onDraftName={(text) => {
        setDraft(text);
        setNameProblem(undefined);
      }}
      onSaveName={() => {
        const clean = normaliseDisplayName(draft);
        if (!isValidDisplayName(clean)) {
          setNameProblem(t('account', 'name_unusable'));
          return;
        }
        void save({ name: clean, zone }).then((saved) => {
          if (saved) setEditing(false);
          else setNameProblem(t('account', 'couldnt_save'));
        });
      }}
      onCloseName={() => setEditing(false)}
      onChangeZone={() => setPicking(true)}
      onPrivacy={() => router.push('/settings/privacy')}
      onNotifications={() => router.push('/settings/notifications')}
      onSignOut={() => {
        setBusy(true);
        setProblem(undefined);
        signOut()
          .then(() => {
            queryClient.clear();
            router.replace('/');
          })
          .catch(() => {
            // Still signed in, and saying so: going to Welcome now would be
            // telling somebody on a shared phone that they had left.
            setBusy(false);
            setProblem(t('account', 'couldnt_sign_out'));
          });
      }}
      onBack={back}
    />
  );
}
