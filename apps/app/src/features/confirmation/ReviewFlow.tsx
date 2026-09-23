import { useIsFocused, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { t } from '../../copy';
import { hasBackend } from '../../data/auth/client';
import type { ChasedAnswer } from '../../data/confirmation';
import { isLockedIn, type PlanCandidates } from '../../data/scheduling';
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

  // Once the plan is locked in: **off whatever screen is under the review
  // and on to the confirmed screen, in one go.** Replacing only the review left
  // the options (or the waiting or no-quorum door, which render the same
  // flow) under the confirmed screen, where hardware and browser Back landed
  // on them and they sent you forward again. Popping to them and waiting for
  // their own redirect showed them, with a live Review button, for as long as
  // their next read took. So: pop the review — by position, not by a route
  // name that may not be the one underneath — and replace what is then on top
  // with the confirmed screen, in the same tick, so both go through the
  // routing queue together and the screen underneath never renders on top.
  // With nothing under the review (a deep link), the replace alone does it.
  // The plan's own circle once it is read; the route's only before that.
  const onTop = useRef(true);
  const toConfirmed = (circleId: string = data?.circleId ?? id) => {
    // Only while the review is still the screen on top. A lock-in can land
    // after somebody pressed Back during it; popping by position then took
    // the options, and the replace took circle home out of the stack.
    if (onTop.current && router.canDismiss()) router.dismiss();
    router.replace({
      pathname: '/circles/[id]/plan/[planId]/confirmed',
      params: { id: circleId, planId },
    });
  };
  // Once, guarded by a ref: `useRouter` can hand back a new object per render,
  // and a lock-in's own refetch would otherwise send the person a second time.
  const sent = useRef(false);
  const lock = useLockIn({
    planId,
    onLocked: (circleId) => {
      sent.current = true;
      toConfirmed(circleId);
    },
  });

  // The first set this screen showed. A later one is a change the organiser
  // is told about, not one that happens under them.
  // Set while rendering, React's pattern for state that follows a prop.
  const setId = data?.set?.id;
  if (setId !== undefined && seenSet === undefined) setSeenSet(setId);

  // Already decided — by this organiser in another tab, or a moment ago. The
  // screen waits on a locked-in plan whatever the read's age, and leaves only
  // on the refusal or on a read that landed since mount: a cached plan could be
  // one the confirmed screen has just sent back here as reopened, and a failed
  // refetch is not a read.
  const locked = data !== undefined && isLockedIn(data.state);
  const fresh = query.isFetchedAfterMount && !query.isError;
  const focused = useIsFocused();
  // Read by `toConfirmed`, which can run after this screen has gone.
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
    // Say why, because the three are different news: an answer moved the
    // options, there are none to pick from, or the plan has stopped asking.
    const why =
      data.view === 'ready'
        ? (['gone_title', 'gone_body'] as const)
        : data.view === 'closed'
          ? (['stopped_title', 'stopped_body'] as const)
          : (['none_title', 'none_body'] as const);
    return (
      <ConfirmReviewScreen
        state="expired"
        message={t('confirmReview', why[0])}
        detail={t('confirmReview', why[1])}
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
