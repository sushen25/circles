import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { t } from '../../copy';
import { hasBackend } from '../../data/auth/client';
import type { ChasedAnswer } from '../../data/confirmation';
import type { PlanCandidates } from '../../data/scheduling';
import { isOffline } from '../identity/join/failure';
import * as fixture from '../scheduling/fixtures';
import { useCandidates } from '../scheduling/useCandidates';
import { ConfirmReviewScreen } from './ConfirmReviewScreen';
import { candidateIn, fieldsOf, reviewOf, type ReviewForm } from './review';
import { useLockIn } from './useLockIn';

/**
 * `/circles/:id/plan/:planId/review?candidate=<ISO start>` — the organiser's
 * last look before a time is frozen (spec §5.7).
 *
 * The candidate arrives as its start instant (S1-27's handover), which is the
 * id `confirm-meetup` takes. The screen reads the same `planCandidates` the
 * options did, and keeps reading it while it is open: an answer can land
 * while the organiser types the place, and what they lock in is what is on
 * screen — so when the set under it changes, the screen says so rather than
 * quietly showing different numbers (S1-27's round five).
 */
export function ReviewFlow({
  id,
  planId,
  candidate,
}: {
  id: string;
  planId: string;
  candidate: string | undefined;
}) {
  return hasBackend() ? (
    <LiveReview id={id} planId={planId} candidate={candidate ?? ''} />
  ) : (
    <FixtureReview />
  );
}

const EMPTY: ReviewForm = { placeName: '', placeUrl: '', note: '' };

function FixtureReview() {
  const router = useRouter();
  const [form, setForm] = useState<ReviewForm>(EMPTY);
  const [chased, setChased] = useState<ChasedAnswer>();
  const data = fixture.ready;
  const row = data.candidates[0]!;
  return (
    <Review
      data={data}
      row={row}
      form={form}
      setForm={setForm}
      chased={chased}
      setChased={setChased}
      onLockIn={() => router.push('/circles/sunday-crew/plan/thu-17/confirmed')}
      onBack={() => router.back()}
    />
  );
}

function LiveReview({ id, planId, candidate }: { id: string; planId: string; candidate: string }) {
  const router = useRouter();
  const query = useCandidates({ planId });
  const data = query.data ?? undefined;
  const [form, setForm] = useState<ReviewForm>(EMPTY);
  const [chased, setChased] = useState<ChasedAnswer>();
  const [seenSet, setSeenSet] = useState<string>();

  // The plan's own circle once it is read; the route's only before that.
  const toConfirmed = (circleId: string = data?.circleId ?? id) =>
    router.replace({
      pathname: '/circles/[id]/plan/[planId]/confirmed',
      params: { id: circleId, planId },
    });
  const lock = useLockIn({ planId, onLocked: toConfirmed });

  // The first set this screen showed. A later one is a change the organiser
  // is told about, not one that happens under them.
  // Set while rendering, React's pattern for state that follows a prop.
  const setId = data?.set?.id;
  if (setId !== undefined && seenSet === undefined) setSeenSet(setId);

  // Already decided — by this organiser in another tab, or a moment ago.
  // Once, guarded by a ref: `useRouter` can hand back a new object per render.
  const decided =
    lock.already ||
    (data !== undefined && (data.state === 'confirmed' || data.state === 'completed'));
  const sent = useRef(false);
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

  if (query.isPending || decided) return <ConfirmReviewScreen state="loading" onBack={back} />;
  if (query.isError) {
    return (
      <ConfirmReviewScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => void query.refetch()}
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
  // Only the organiser decides (§5.6); everybody else may see the options.
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

  const row = candidateIn(data, candidate);
  if (row === undefined) {
    return (
      <ConfirmReviewScreen
        state="expired"
        message={t('confirmReview', 'gone_title')}
        detail={t('confirmReview', 'gone_body')}
        onBack={back}
      />
    );
  }

  const moved = seenSet !== undefined && setId !== undefined && setId !== seenSet;
  return (
    <Review
      data={data}
      row={row}
      form={form}
      setForm={setForm}
      chased={chased}
      setChased={setChased}
      notice={lock.problem ?? (moved ? t('confirmReview', 'moved') : undefined)}
      waiting={data.stale}
      busy={lock.busy}
      onLockIn={(fields) => {
        if (chased === undefined || setId === undefined) return;
        // What is on screen now is what the organiser is confirming.
        setSeenSet(setId);
        lock.lockIn({
          circleId: data.circleId,
          candidateId: row.id,
          expectedSetId: setId,
          invitedCount: data.askedCount,
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

function Review({
  data,
  row,
  form,
  setForm,
  chased,
  setChased,
  notice,
  waiting,
  busy,
  onLockIn,
  onBack,
}: {
  data: PlanCandidates;
  row: PlanCandidates['candidates'][number];
  form: ReviewForm;
  setForm: (next: ReviewForm) => void;
  chased: ChasedAnswer | undefined;
  setChased: (answer: ChasedAnswer) => void;
  notice?: string | undefined;
  waiting?: boolean | undefined;
  busy?: boolean | undefined;
  onLockIn: (fields: Fields) => void;
  onBack: () => void;
}) {
  const view = reviewOf(data, row);
  const fields = fieldsOf(form);
  return (
    <ConfirmReviewScreen
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
      waiting={waiting}
      busy={busy}
      canLockIn={fields.valid && chased !== undefined}
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
