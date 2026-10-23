import type { IdempotencyKey } from '@circles/contracts';
import { mayManageCircle, type Cadence, type NudgePolicy } from '@circles/domain';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';

import { t } from '../../copy';
import { useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import {
  leaveCircle,
  removeMember,
  resetInviteLink,
  saveMySwitches,
  updateCircle,
  useCircle,
  type CirclePatch,
  type CircleHome,
  circleKeys,
} from '../../data/circles';
import { newIdempotencyKey } from '../../data/functions';
import { isOffline, neverReachedServer } from '../identity/join/failure';
import { showHomeAtOnce, type HomeChange } from './optimisticHome';
import { SettingsScreen } from './SettingsScreen';
import {
  cadenceLabel,
  cadenceOptions,
  memberRows,
  policyLabel,
  policyOf,
  policyOptions,
} from './settingsWords';
import { RenameSheet } from './RenameSheet';
import { ConfirmSheet, PickerSheet } from './sheets';
import { fullHint, fullLine, isFull } from './words';

/**
 * `/circles/:id/settings` (spec §5.2). The route is behind `MembershipGate`, so
 * only an active member gets here; what they may *change* is the domain's
 * `mayManageCircle`, and the server is the authority for all of it.
 *
 * - **Who's in, and Add someone** for any member (ADR 0091): the invitation
 *   itself is the Add someone screen's. **Cancel old invitations**, the
 *   owner's alone, is `rotate-invite` behind a sheet that says plans already
 *   shared keep working. The secret is held in memory only
 *   (`data/circles/invite.ts`), never in a query.
 * - **The owner's settings** are updates through RLS; **the reader's quiet-asks
 *   switch** is their own membership row.
 * - **Remove** goes through `remove-member`, **Archive** is the owner's update.
 * - **Change my name here** is on the reader's own row only: `rename-in-circle`
 *   (SUS-205, ADR 0070) sets what this one circle calls them.
 */
export function SettingsFlow({ id }: { id: string }) {
  return hasBackend() ? <LiveSettings id={id} /> : <FixtureSettings />;
}

function FixtureSettings() {
  const router = useRouter();
  return (
    <SettingsScreen
      onAddSomeone={() => router.push('/circles/sunday-crew/invite')}
      onBack={() => router.back()}
    />
  );
}

type Asking =
  | { kind: 'cancel_invitations' }
  | { kind: 'remove'; userId: string; name: string }
  | { kind: 'archive' }
  | { kind: 'leave' }
  | { kind: 'rename' }
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
  const [inviteNote, setInviteNote] = useState<string | undefined>();
  const keys = useRef(new Map<string, IdempotencyKey>());

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

  // A choice the server nearly always accepts (colour, how often, who gets
  // nudged, the quiet-asks switch) shows at once and is put back, with the
  // notice, if the server refuses (manifesto §7.4).
  const homeKey = circleKeys.home(id, session.userId);
  const showAtOnce = (change: HomeChange) => showHomeAtOnce(queryClient, homeKey, change);

  const save = async (patch: CirclePatch) => {
    setProblem(undefined);
    if (patch.status === undefined && patch.cadenceSnoozedUntil === undefined) {
      showAtOnce({
        ...(patch.color === undefined ? {} : { color: patch.color }),
        ...(patch.cadence === undefined ? {} : { cadence: patch.cadence }),
        ...(patch.nudgePolicy === undefined ? {} : { nudgePolicy: patch.nudgePolicy }),
      });
    }
    try {
      await updateCircle(id, patch);
      await refresh();
    } catch (error) {
      void refresh();
      setProblem(
        neverReachedServer(error) ? t('settings', 'youre_offline') : t('settings', 'couldnt_save'),
      );
    }
  };

  const confirm = async () => {
    if (asking === undefined || busy) return;
    setBusy(true);
    setSheetProblem(undefined);
    try {
      if (asking.kind === 'cancel_invitations') {
        await resetInviteLink(id, keyFor('reset'));
        // The reset has happened: the next one is a new request. Nothing after
        // this line may fail the mutation, or a retry under a fresh key would
        // rotate again and kill the invitation this one made (review round 1).
        // The new secret is already held.
        keys.current.delete('reset');
        setInviteNote(t('settings', 'old_invitations_cancelled'));
      } else if (asking.kind === 'remove') {
        await removeMember(id, asking.userId, keyFor(`remove:${asking.userId}`));
        await refresh();
      } else if (asking.kind === 'leave') {
        await leaveCircle(id, keyFor('leave'));
        // They are out: the circle is no longer theirs to see, on this device
        // or in the list, and this screen has nothing left to show.
        await queryClient.invalidateQueries({ queryKey: ['circles'] });
        router.replace('/circles');
        return;
      } else if (asking.kind === 'archive') {
        await updateCircle(id, { status: 'archived' });
        await queryClient.invalidateQueries({ queryKey: ['circles'] });
        await refresh();
      }
      close();
    } catch (error) {
      setSheetProblem(
        neverReachedServer(error)
          ? t('settings', 'youre_offline')
          : asking.kind === 'cancel_invitations'
            ? t('settings', 'couldnt_cancel_invitations')
            : asking.kind === 'remove'
              ? t('settings', 'couldnt_remove', { name: asking.name })
              : asking.kind === 'leave'
                ? t('settings', 'couldnt_leave')
                : t('settings', 'couldnt_save'),
      );
    } finally {
      setBusy(false);
    }
  };

  const confirmSheet =
    asking?.kind === 'cancel_invitations'
      ? {
          title: t('settings', 'cancel_invitations_title'),
          body: t('settings', 'cancel_invitations_body', { circle: data.name }),
          confirmLabel: t('settings', 'cancel_them'),
          dismissLabel: t('settings', 'keep_them'),
        }
      : asking?.kind === 'remove'
        ? {
            title: t('settings', 'remove_title', { name: asking.name }),
            body: t('settings', 'remove_body', { name: asking.name, circle: data.name }),
            confirmLabel: t('settings', 'remove_name', { name: asking.name }),
          }
        : asking?.kind === 'leave'
          ? {
              title: t('settings', 'leave_title', { circle: data.name }),
              body: t('settings', 'leave_body'),
              confirmLabel: t('settings', 'leave_confirm', { circle: data.name }),
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
      full={isFull(data) ? fullLine(data) : undefined}
      fullHint={isFull(data) && canManage ? fullHint() : undefined}
      inviteNote={inviteNote}
      cadenceLabel={cadenceLabel(data.cadence)}
      policyLabel={policyLabel(policyOf(data))}
      color={data.color}
      quietAsksOn={data.mine === null ? true : !data.mine.mutedQuietAsks}
      members={memberRows(data)}
      archived={data.status === 'archived'}
      problem={problem}
      onAddSomeone={
        isFull(data) || data.status === 'archived'
          ? undefined
          : () => router.push({ pathname: '/circles/[id]/invite', params: { id } })
      }
      onCancelInvitations={
        canManage && data.status !== 'archived'
          ? () => setAsking({ kind: 'cancel_invitations' })
          : undefined
      }
      onChangeCadence={() => setAsking({ kind: 'cadence' })}
      onChangePolicy={() => setAsking({ kind: 'policy' })}
      onColorChange={(color) => void save({ color })}
      onQuietAsksChange={(on) => {
        setProblem(undefined);
        showAtOnce((home) =>
          home.mine === null ? {} : { mine: { ...home.mine, mutedQuietAsks: !on } },
        );
        void saveMySwitches(id, { mutedQuietAsks: !on })
          .then(refresh)
          .catch(() => {
            void refresh();
            setProblem(t('settings', 'couldnt_save'));
          });
      }}
      onRemove={(userId) =>
        setAsking({
          kind: 'remove',
          userId,
          name: data.members.find((m) => m.userId === userId)?.name ?? '',
        })
      }
      onRename={() => setAsking({ kind: 'rename' })}
      onArchiveThisCircle={() => setAsking({ kind: 'archive' })}
      onLeaveThisCircle={() => setAsking({ kind: 'leave' })}
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
        dismissLabel={confirmSheet?.dismissLabel}
        busy={busy}
        problem={sheetProblem}
        onConfirm={() => void confirm()}
        onDismiss={close}
      />
      {asking?.kind === 'rename' ? (
        <RenameSheet
          circleId={id}
          circleName={data.name}
          currentName={data.members.find((m) => m.userId === data.me)?.name ?? ''}
          onDone={async () => {
            // Everything that shows a name: this circle's home and every plan
            // roster read the column again, so the old name is not shown
            // anywhere (SUS-205 chose the new name everywhere, locked-in
            // plans included).
            await queryClient.invalidateQueries();
            close();
          }}
          onClose={close}
        />
      ) : null}
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
