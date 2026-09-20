import { EN_SHARE_TEMPLATES, inviteMessage } from '@circles/domain';
import type { CircleId } from '@circles/contracts';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { track } from '../../analytics/track';
import { useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { circleHome, heldInviteLink } from '../../data/circles';
import { appOrigin } from '../../data/links/origin';
import { copyText, shareMessage } from '../../platform/share';
import { isOffline } from '../identity/join/failure';
import { InviteCircleScreen } from './InviteCircleScreen';

/**
 * `/circles/:id/invite` — the link and the message, ready for the group chat.
 *
 * No longer a step in the first run (ADR 0026): it is reached from circle home,
 * from settings (S1-23) and from "Just invite people for now" on the first
 * plan, for a circle that needs somebody in it with nothing yet to answer.
 *
 * The link is `/join#<secret>`, from the secret `create-circle` returned and
 * FirstCircle held in memory; it is never read from anywhere else, because it
 * exists nowhere else (§14). **It never reaches analytics or a log**: the
 * events here carry the circle's id and how it was shared, and nothing the
 * link or the message contains.
 *
 * Share opens the system sheet where there is one (iOS Safari, Android
 * Chrome) and copies where there is not — the in-app browsers — and the screen
 * says which happened. A shared link moves on to the circle's home; a copied
 * one stays, so the person can go and paste it and come back.
 */
export function InviteCircleFlow({ id }: { id: string }) {
  return hasBackend() ? <LiveInvite id={id} /> : <FixtureInvite id={id} />;
}

function FixtureInvite({ id }: { id: string }) {
  const router = useRouter();
  const home = () => router.push({ pathname: '/circles/[id]', params: { id, state: 'joining' } });
  return <InviteCircleScreen onNext={home} onSkipForNowIll={home} onBack={() => router.back()} />;
}

function LiveInvite({ id }: { id: string }) {
  const router = useRouter();
  const session = useSession();
  const [outcome, setOutcome] = useState<'copied' | 'couldnt_copy' | undefined>();
  // Whether the chat has it: the way on stops being a quiet tertiary once the
  // link has actually left (the share screen's rule, ADR 0026).
  const [shared, setShared] = useState(false);

  const home = useQuery({
    queryKey: ['circle-home', id, session.userId],
    queryFn: () => circleHome(id),
    staleTime: 30_000,
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

  const circleName = home.data.name;
  const link = heldInviteLink(id, appOrigin());
  if (link === undefined) {
    return (
      <InviteCircleScreen
        state="expired"
        circleName={circleName}
        onSkipForNowIll={toHome}
        onBack={back}
      />
    );
  }
  const message = inviteMessage({ circleName, url: link, templates: EN_SHARE_TEMPLATES });
  const circle_id = id as CircleId;

  return (
    <InviteCircleScreen
      circleName={circleName}
      link={link}
      message={message}
      outcome={outcome}
      shared={shared}
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
            setShared(true);
            setOutcome('copied');
          } else if (result === 'failed') setOutcome('couldnt_copy');
        });
      }}
      onCopyLink={() => {
        setOutcome(undefined);
        void copyText(link).then((copied) => {
          if (copied) {
            track('circle_invite_shared', { circle_id, kind: 'copy' });
            setShared(true);
          }
          setOutcome(copied ? 'copied' : 'couldnt_copy');
        });
      }}
      onSkipForNowIll={toHome}
      onBack={back}
    />
  );
}
