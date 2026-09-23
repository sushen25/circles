import type { CircleId, IdempotencyKey } from '@circles/contracts';
import { mayManageCircle, type Cadence, type NudgePolicy } from '@circles/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import {
  fetchInviteSecret,
  heldInviteLink,
  removeMember,
  resetInviteLink,
  saveMySwitches,
  updateCircle,
  useCircle,
  type CirclePatch,
  type CircleHome,
} from '../../data/circles';
import { newIdempotencyKey } from '../../data/functions';
import { appOrigin } from '../../data/links/origin';
import { copyText } from '../../platform/share';
import { isOffline } from '../identity/join/failure';
import { SettingsScreen, type InviteView } from './SettingsScreen';
import {
  cadenceLabel,
  cadenceOptions,
  linkDisplay,
  memberRows,
  policyLabel,
  policyOf,
  policyOptions,
} from './settingsWords';
import { ConfirmSheet, PickerSheet } from './sheets';

/**
 * `/circles/:id/settings` (spec §5.2). The route is behind `MembershipGate`, so
 * only an active member gets here; what they may *change* is the domain's
 * `mayManageCircle`, and the server is the authority for all of it.
 *
 * - **The link**: shown again through `get-invite-link` (ADR 00XX), copied,
 *   or reset through `rotate-invite`. The secret is held in memory only
 *   (`data/circles/invite.ts`); the query caches whether there is one, never
 *   the secret itself.
 * - **The owner's settings** are updates through RLS; **the reader's quiet-asks
 *   switch** is their own membership row.
 * - **Remove** goes through `remove-member`, **Archive** is the owner's update.
 */
export function SettingsFlow({ id }: { id: string }) {
  return hasBackend() ? <LiveSettings id={id} /> : <FixtureSettings />;
}

function FixtureSettings() {
  const router = useRouter();
  return (
    <SettingsScreen
      onCopyLink={() => router.push('/circles/sunday-crew/invite')}
      onBack={() => router.back()}
    />
  );
}

type Asking =
  | { kind: 'reset' }
  | { kind: 'remove'; userId: string; name: string }
  | { kind: 'archive' }
  | { kind: 'cadence' }
  | { kind: 'policy' };

function LiveSettings({ id }: { id: string }) {
  const router = useRouter();
  const session = useSession();
  const queryClient = useQueryClient();
  const home = useCircle(id);
  const [asking, setAsking] = useState<Asking | undefined>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [sheetProblem, setSheetProblem] = useState<string | undefined>();
  const [linkNote, setLinkNote] = useState<string | undefined>();
  const keys = useRef(new Map<string, IdempotencyKey>());

  const owner = home.data !== undefined && home.data !== null && home.data.isOwner;
  // Whether the link can be shown; the secret itself stays in `invite.ts`.
  const link = useQuery({
    queryKey: ['invite-link-shown', id, session.userId],
    queryFn: async () => (await fetchInviteSecret(id)) !== undefined,
    enabled: owner,
    staleTime: Infinity,
  });

  const back = () =>
    router.canGoBack()
      ? router.back()
      : router.replace({ pathname: '/circles/[id]', params: { id } });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['circle-home', id] });
  const keyFor = (what: string) => {
    const existing = keys.current.get(what);
    if (existing !== undefined) return existing;
    const made = newIdempotencyKey();
    keys.current.set(what, made);
    return made;
  };
  const close = () => {
    setAsking(undefined);
    setSheetProblem(undefined);
  };

  if (home.isPending) return <SettingsScreen state="loading" onBack={back} />;
  if (home.isError || home.data === null) {
    return (
      <SettingsScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => void home.refetch()}
        onBack={back}
      />
    );
  }
  const data: CircleHome = home.data;
  const canManage = mayManageCircle({ viewerIsOwner: data.isOwner });

  const save = async (patch: CirclePatch) => {
    setProblem(undefined);
    try {
      await updateCircle(id, patch);
      await refresh();
    } catch {
      setProblem(isOffline() ? t('settings', 'youre_offline') : t('settings', 'couldnt_save'));
    }
  };

  const held = heldInviteLink(id, appOrigin());
  const invite: InviteView =
    held !== undefined
      ? { kind: 'shown', display: linkDisplay(held.slice(held.indexOf('#') + 1)) }
      : link.isPending || link.isFetching
        ? { kind: 'loading' }
        : { kind: 'unshowable' };

  const confirm = async () => {
    if (asking === undefined || busy) return;
    setBusy(true);
    setSheetProblem(undefined);
    try {
      if (asking.kind === 'reset') {
        await resetInviteLink(id, keyFor('reset'));
        // The reset has happened: the next one is a new request. Nothing after
        // this line may fail the mutation, or a retry under a fresh key would
        // rotate again and kill the link this one made (review round 1). The
        // secret is already held; the refetch only refreshes the cache.
        keys.current.delete('reset');
        setLinkNote(t('settings', 'new_link_ready'));
        void link.refetch();
      } else if (asking.kind === 'remove') {
        await removeMember(id, asking.userId, keyFor(`remove:${asking.userId}`));
        await refresh();
      } else if (asking.kind === 'archive') {
        await updateCircle(id, { status: 'archived' });
        await queryClient.invalidateQueries({ queryKey: ['circles'] });
        await refresh();
      }
      close();
    } catch {
      setSheetProblem(
        isOffline()
          ? t('settings', 'youre_offline')
          : asking.kind === 'reset'
            ? t('settings', 'couldnt_reset')
            : asking.kind === 'remove'
              ? t('settings', 'couldnt_remove', { name: asking.name })
              : t('settings', 'couldnt_save'),
      );
    } finally {
      setBusy(false);
    }
  };

  const confirmSheet =
    asking?.kind === 'reset'
      ? {
          title: t('settings', 'reset_title'),
          body: t('settings', 'reset_body', { circle: data.name }),
          confirmLabel: t('settings', 'reset_link'),
        }
      : asking?.kind === 'remove'
        ? {
            title: t('settings', 'remove_title', { name: asking.name }),
            body: t('settings', 'remove_body', { name: asking.name, circle: data.name }),
            confirmLabel: t('settings', 'remove_name', { name: asking.name }),
          }
        : asking?.kind === 'archive'
          ? {
              title: t('settings', 'archive_title', { circle: data.name }),
              body: t('settings', 'archive_body'),
              confirmLabel: t('settings', 'archive'),
            }
          : undefined;

  return (
    <SettingsScreen
      circleName={data.name}
      canManage={canManage}
      ownerName={data.members.find((m) => m.role === 'owner')?.name ?? ''}
      invite={invite}
      linkNote={linkNote}
      cadenceLabel={cadenceLabel(data.cadence)}
      policyLabel={policyLabel(policyOf(data))}
      color={data.color}
      quietAsksOn={data.mine === null ? true : !data.mine.mutedQuietAsks}
      members={memberRows(data)}
      archived={data.status === 'archived'}
      problem={problem}
      onCopyLink={() => {
        if (held === undefined) return;
        setLinkNote(undefined);
        void copyText(held).then((copied) => {
          if (copied) track('circle_invite_shared', { circle_id: id as CircleId, kind: 'copy' });
          setLinkNote(copied ? t('settings', 'copied') : t('settings', 'couldnt_copy'));
        });
      }}
      onResetLink={() => setAsking({ kind: 'reset' })}
      onChangeCadence={() => setAsking({ kind: 'cadence' })}
      onChangePolicy={() => setAsking({ kind: 'policy' })}
      onColorChange={(color) => void save({ color })}
      onQuietAsksChange={(on) => {
        setProblem(undefined);
        void saveMySwitches(id, { mutedQuietAsks: !on })
          .then(refresh)
          .catch(() => setProblem(t('settings', 'couldnt_save')));
      }}
      onRemove={(userId) =>
        setAsking({
          kind: 'remove',
          userId,
          name: data.members.find((m) => m.userId === userId)?.name ?? '',
        })
      }
      onArchiveThisCircle={() => setAsking({ kind: 'archive' })}
      onBringBack={() =>
        void save({ status: 'active' }).then(() =>
          queryClient.invalidateQueries({ queryKey: ['circles'] }),
        )
      }
      onBack={back}
    >
      <ConfirmSheet
        visible={confirmSheet !== undefined}
        title={confirmSheet?.title ?? ''}
        body={confirmSheet?.body}
        confirmLabel={confirmSheet?.confirmLabel ?? ''}
        busy={busy}
        problem={sheetProblem}
        onConfirm={() => void confirm()}
        onDismiss={close}
      />
      <PickerSheet<Cadence>
        visible={asking?.kind === 'cadence'}
        title={t('settings', 'cadence_title')}
        options={cadenceOptions()}
        selected={data.cadence}
        onPick={(cadence) => {
          close();
          void save({ cadence });
        }}
        onDismiss={close}
      />
      <PickerSheet<NudgePolicy>
        visible={asking?.kind === 'policy'}
        title={t('settings', 'nudge_title')}
        hint={t('settings', 'nudge_hint')}
        options={policyOptions()}
        selected={policyOf(data)}
        onPick={(nudgePolicy) => {
          close();
          void save({ nudgePolicy });
        }}
        onDismiss={close}
      />
    </SettingsScreen>
  );
}
