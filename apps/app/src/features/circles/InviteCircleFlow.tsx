import { brand } from '@circles/config';
import { EN_SHARE_TEMPLATES, inviteMessage } from '@circles/domain';
import type { CircleId } from '@circles/contracts';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { circleHome, fetchInviteSecret, heldInviteLink } from '../../data/circles';
import { appOrigin } from '../../data/links/origin';
import { copyText, shareMessage } from '../../platform/share';
import { isOffline } from '../identity/join/failure';
import { PlanStateScreen } from '../planning/states';
import { InviteCircleScreen } from './InviteCircleScreen';
import { fullHint, fullLine, isFull } from './words';

/**
 * `/circles/:id/invite` — Add someone: the invitation, ready for the chat.
 *
 * Any active member can open it (ADR 0091): `get-invite-link` answers every
 * member, and only resetting is the owner's. No longer a step in the first run
 * (ADR 0026): it is reached from circle home between plans, from settings
 * (S1-23) and from "Just invite people for now" on the first plan, for a
 * circle that needs somebody in it with nothing yet to answer.
 *
 * The link is `/join#<secret>`, from the secret this tab holds in memory — from
 * `create-circle`, a reset, or, after a reload, the member asking
 * `get-invite-link` for it again (ADR 0028). **It never reaches analytics or a
 * log**: the events here carry the circle's id and how it was shared, and
 * nothing the link or the message contains.
 *
 * Share opens the system sheet where there is one (iOS Safari, Android
 * Chrome) and copies where there is not — the in-app browsers — and the screen
 * says which happened. A shared invitation moves on to the circle's home; a
 * copied one stays, so the person can go and paste it and come back.
 */
export function InviteCircleFlow({ id }: { id: string }) {
  return hasBackend() ? <LiveInvite id={id} /> : <FixtureInvite id={id} />;
}

function FixtureInvite({ id }: { id: string }) {
  const router = useRouter();
  const home = () => router.push({ pathname: '/circles/[id]', params: { id, state: 'joining' } });
  return <InviteCircleScreen onNext={home} onBack={() => router.back()} />;
}

function LiveInvite({ id }: { id: string }) {
  const router = useRouter();
  const session = useSession();
  const [outcome, setOutcome] = useState<'copied' | 'couldnt_copy' | undefined>();

  const home = useQuery({
    queryKey: ['circle-home', id, session.userId],
    queryFn: () => circleHome(id),
    staleTime: 30_000,
  });
  const owner = home.data !== undefined && home.data !== null && home.data.isOwner;
  const atCap = home.data !== undefined && home.data !== null && isFull(home.data);
  // After a reload the link is not in memory: any member asks for it again
  // (ADR 0028, ADR 0091). The query answers only whether it came back — the
  // secret goes to `invite.ts` and never into the cache.
  const shown = useQuery({
    queryKey: ['invite-link-shown', id, session.userId],
    queryFn: async () => (await fetchInviteSecret(id)) !== undefined,
    // Asked on every visit, held or not: somebody else may have cancelled the
    // invitation this tab holds, and a member depends on that more than an owner.
    enabled: home.data !== undefined && home.data !== null && !atCap,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const toHome = () => router.replace({ pathname: '/circles/[id]', params: { id } });
  const back = () => (router.canGoBack() ? router.back() : toHome());

  if (home.isPending) return <InviteCircleScreen state="loading" onBack={back} />;
  if (home.isError || home.data === null) {
    return (
      <InviteCircleScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => void home.refetch()}
        onBack={back}
      />
    );
  }

  // At the cap the link would only turn people away (ADR 0012): say so, and
  // point at the one place that can make room.
  if (isFull(home.data)) {
    return (
      <PlanStateScreen
        state="empty"
        title={fullLine(home.data)}
        body={fullHint()}
        action={owner ? t('circleHome', 'full_action') : undefined}
        onAction={() => router.replace({ pathname: '/circles/[id]/settings', params: { id } })}
        onBack={back}
      />
    );
  }

  const circleName = home.data.name;
  const link = heldInviteLink(id, appOrigin());
  if (link === undefined && shown.fetchStatus === 'fetching') {
    return <InviteCircleScreen state="loading" onBack={back} />;
  }
  if (link === undefined && shown.isError) {
    return (
      <InviteCircleScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => void shown.refetch()}
        onBack={back}
      />
    );
  }
  if (link === undefined) {
    return (
      <InviteCircleScreen
        state="expired"
        circleName={circleName}
        onHome={toHome}
        onSettings={
          owner
            ? () => router.replace({ pathname: '/circles/[id]/settings', params: { id } })
            : undefined
        }
        onBack={back}
      />
    );
  }
  const message = inviteMessage({
    circleName,
    brandName: brand.name,
    url: link,
    templates: EN_SHARE_TEMPLATES,
  });
  const circle_id = id as CircleId;

  return (
    <InviteCircleScreen
      circleName={circleName}
      link={link}
      message={message}
      outcome={outcome}
      onNext={() => {
        setOutcome(undefined);
        void shareMessage(message).then((result) => {
          if (result === 'sheet' || result === 'dismissed') {
            // The sheet opened, which is the event (S1-22): whether they went
            // on to pick a chat is something the web is not told.
            track('circle_invite_shared', { circle_id, kind: 'sheet' });
            track('share_opened', { circle_id, kind: 'invite' });
          }
          if (result === 'sheet') toHome();
          else if (result === 'copied') {
            track('circle_invite_shared', { circle_id, kind: 'copy' });
            setOutcome('copied');
          } else if (result === 'failed') setOutcome('couldnt_copy');
        });
      }}
      onCopy={() => {
        setOutcome(undefined);
        void copyText(message).then((copied) => {
          if (copied) track('circle_invite_shared', { circle_id, kind: 'copy' });
          setOutcome(copied ? 'copied' : 'couldnt_copy');
        });
      }}
      onBack={back}
    />
  );
}
