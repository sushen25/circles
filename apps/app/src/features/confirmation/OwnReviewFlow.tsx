import { type Instant } from '@circles/domain';
import { useIsFocused, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { t } from '../../copy';
import { hasBackend } from '../../data/auth/client';
import type { ChasedAnswer } from '../../data/confirmation';
import { isLockedIn } from '../../data/scheduling';
import { isOffline } from '../identity/join/failure';
import { clockNow, usePlanClock } from '../planning/clock';
import * as fixture from '../scheduling/fixtures';
import { useCandidates } from '../scheduling/useCandidates';
import { ConfirmReviewScreen } from './ConfirmReviewScreen';
import { fixtureStretch } from './fixtureStretch';
import { ownReviewOf } from './ownReview';
import { fieldsOf, type ReviewForm } from './review';
import { problemOf as timeProblemOf, pickOf } from './time';
import { useLockInOwn } from './useLockInOwn';
import { useStretch } from './useStretch';

/**
 * `/circles/:id/plan/:planId/review?start=<ISO>&end=<ISO>` — the organiser's last
 * look at a time they chose themselves (ADR 0051).
 *
 * The same screen as the options' review, with the chosen time, who it works for
 * by name, and one caution in place of the unanswered warning. Place, note, the
 * chase question and "Lock it in" are unchanged. The screen keeps reading who
 * the time works for while it is open: an answer can land while the organiser
 * types the place, and what they lock in is what is on screen — so when the names
 * under it change, it says so rather than quietly showing different ones, and
 * asks again.
 */
export function OwnReviewFlow({
  id,
  planId,
  start,
  end,
}: {
  id: string;
  planId: string;
  start: string;
  end: string;
}) {
  return hasBackend() ? (
    <LiveOwnReview id={id} planId={planId} start={start} end={end} />
  ) : (
    <FixtureOwnReview />
  );
}

const EMPTY: ReviewForm = { placeName: '', placeUrl: '', note: '' };

function FixtureOwnReview() {
  const router = useRouter();
  const [form, setForm] = useState<ReviewForm>(EMPTY);
  const [chased, setChased] = useState<ChasedAnswer>();
  const startsAt = '2026-09-18T09:00:00.000Z';
  const endsAt = '2026-09-18T11:00:00.000Z';
  const view = ownReviewOf(fixture.ready, fixtureStretch(startsAt, endsAt), startsAt, endsAt);
  return (
    <OwnReview
      view={view}
      form={form}
      setForm={setForm}
      chased={chased}
      setChased={setChased}
      onLockIn={() => router.push('/circles/sunday-crew/plan/thu-17/confirmed')}
      onBack={() => router.back()}
    />
  );
}

function LiveOwnReview({
  id,
  planId,
  start,
  end,
}: {
  id: string;
  planId: string;
  start: string;
  end: string;
}) {
  const router = useRouter();
  const query = useCandidates({ planId });
  const data = query.data ?? undefined;
  // Only once the read says this is the organiser: the answer is theirs alone, and
  // asking as anybody else would show a generic error ahead of "only the organiser".
  const stretch = useStretch(planId, { startsAt: start, endsAt: end }, data?.isOrganiser === true);
  const [clock] = usePlanClock(clockNow, true);
  const [form, setForm] = useState<ReviewForm>(EMPTY);
  const [chased, setChased] = useState<ChasedAnswer>();
  const [seen, setSeen] = useState<number>();

  // Off the review and the picker beneath it, and on to the confirmed screen in
  // one go, for the reason `ReviewFlow` gives: whatever is left underneath must
  // not render, with a live button, before it redirects. Only while the review is
  // still the screen on top.
  const onTop = useRef(true);
  const sent = useRef(false);
  const toConfirmed = (circleId: string = data?.circleId ?? id) => {
    if (!onTop.current) return;
    if (router.canDismiss()) router.dismiss(2);
    router.replace({
      pathname: '/circles/[id]/plan/[planId]/confirmed',
      params: { id: circleId, planId },
    });
  };
  const lock = useLockInOwn({
    planId,
    onLocked: (circleId) => {
      sent.current = true;
      toConfirmed(circleId);
    },
  });

  // The first version of the names this screen showed. A later one is a change
  // the organiser is told about, not one that happens under them. Set while
  // rendering, React's pattern for state that follows a prop.
  const version = stretch.data?.inputVersion;
  if (version !== undefined && seen === undefined) setSeen(version);

  const locked = data !== undefined && isLockedIn(data.state);
  const fresh = query.isFetchedAfterMount && !query.isError;
  const focused = useIsFocused();
  useEffect(() => {
    onTop.current = focused;
    return () => {
      onTop.current = false;
    };
  }, [focused]);
  const decided = lock.already || (locked && fresh && focused);
  useEffect(() => {
    if (!decided || sent.current) return;
    sent.current = true;
    toConfirmed();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, by the ref
  }, [decided]);

  const back = () =>
    router.canGoBack()
      ? router.back()
      : router.replace({
          pathname: '/circles/[id]/plan/[planId]/candidates',
          params: { id, planId },
        });

  if (query.isPending || lock.already || (locked && !query.isError)) {
    return <ConfirmReviewScreen state="loading" onBack={back} />;
  }
  if (query.isError || (data?.isOrganiser === true && stretch.isError)) {
    return (
      <ConfirmReviewScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => {
          void query.refetch();
          void stretch.refetch();
        }}
        onBack={back}
      />
    );
  }
  if (data === undefined) {
    return (
      <ConfirmReviewScreen
        state="denied"
        message={t('candidates', 'denied_title')}
        detail={t('candidates', 'denied_body')}
        onBack={back}
      />
    );
  }
  if (!data.isOrganiser) {
    return (
      <ConfirmReviewScreen
        state="denied"
        message={t('confirmReview', 'not_organiser_title')}
        detail={t('confirmReview', 'not_organiser_body')}
        onBack={back}
      />
    );
  }
  // Only while the plan is still deciding, and only for a time the domain accepts.
  if (!['collecting', 'ready'].includes(data.state)) {
    return (
      <ConfirmReviewScreen
        state="expired"
        message={t('confirmReview', 'stopped_title')}
        detail={t('confirmReview', 'stopped_body')}
        onBack={back}
      />
    );
  }
  if (timeProblemOf(data, pickOf(start, end, data.zone), clock as Instant) !== undefined) {
    return (
      <ConfirmReviewScreen
        state="expired"
        message={t('confirmReview', 'own_gone_title')}
        detail={t('confirmReview', 'own_gone_body')}
        onBack={back}
      />
    );
  }
  if (stretch.data === undefined) return <ConfirmReviewScreen state="loading" onBack={back} />;

  const moved = seen !== undefined && stretch.data.inputVersion !== seen;
  const view = ownReviewOf(data, stretch.data, start, end);
  return (
    <OwnReview
      view={view}
      form={form}
      setForm={setForm}
      chased={chased}
      setChased={setChased}
      notice={lock.problem ?? (moved ? t('confirmReview', 'own_moved') : undefined)}
      busy={lock.busy}
      onLockIn={(fields) => {
        if (stretch.data === undefined) return;
        // What is on screen now is what the organiser is confirming.
        setSeen(stretch.data.inputVersion);
        lock.lockIn({
          circleId: data.circleId,
          startsAt: start,
          endsAt: end,
          expectedInputVersion: stretch.data.inputVersion,
          invitedCount: data.askedCount,
          belowQuorum: view.belowQuorum,
          chasedAnswer: chased,
          ...fields,
        });
      }}
      onBack={back}
    />
  );
}

type Fields = {
  placeName: string | undefined;
  placeUrl: string | undefined;
  note: string | undefined;
};

function OwnReview({
  view,
  form,
  setForm,
  chased,
  setChased,
  notice,
  busy,
  onLockIn,
  onBack,
}: {
  view: ReturnType<typeof ownReviewOf>;
  form: ReviewForm;
  setForm: (next: ReviewForm) => void;
  chased: ChasedAnswer | undefined;
  setChased: (answer: ChasedAnswer) => void;
  notice?: string | undefined;
  busy?: boolean | undefined;
  onLockIn: (fields: Fields) => void;
  onBack: () => void;
}) {
  const fields = fieldsOf(form);
  return (
    <ConfirmReviewScreen
      backTitle={t('confirmReview', 'back_to_time')}
      date={view.date}
      time={view.time}
      members={view.members}
      membersLabel={view.membersLabel}
      summary={view.summary}
      zoneNote={view.zoneNote}
      warning={view.warning}
      placeName={form.placeName}
      placeUrl={form.placeUrl}
      placeUrlError={fields.placeUrlError}
      note={form.note}
      noteCount={fields.noteCount}
      chased={chased}
      notice={notice}
      busy={busy}
      canLockIn={fields.valid}
      onPlaceName={(placeName) => setForm({ ...form, placeName })}
      onPlaceUrl={(placeUrl) => setForm({ ...form, placeUrl })}
      onNote={(note) => setForm({ ...form, note })}
      onChase={setChased}
      onLockIn={() =>
        onLockIn({ placeName: fields.placeName, placeUrl: fields.placeUrl, note: fields.note })
      }
      onBack={onBack}
    />
  );
}
