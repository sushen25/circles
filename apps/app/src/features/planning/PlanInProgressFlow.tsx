import { useRouter } from 'expo-router';

import { t } from '../../copy';
import type { CircleHome, HomePlan } from '../../data/circles';
import { PlanInProgressScreen } from './PlanInProgressScreen';
import { whenWords } from './when';

/**
 * The circle already has a plan finding a time (spec §5.3, ADR 00XX). Both
 * ways into making a plan — FirstPlan's one-tap card and the full setup —
 * read circle home first, and both draw this instead of a form when it says
 * so: the plan, and what the reader may do about it.
 *
 * Edit is the organiser's and Cancel the organiser's or the owner's — the
 * transitions' own guards, `organiser` and `organiser_or_owner`, applied to
 * who is reading — so nobody is offered a button whose screen refuses them.
 */
export function PlanInProgress({
  id,
  home,
  plan,
  onBack,
}: {
  id: string;
  home: Pick<CircleHome, 'name' | 'zone' | 'me' | 'isOwner' | 'members'>;
  plan: HomePlan;
  onBack: () => void;
}) {
  const router = useRouter();
  const canEdit = home.me !== undefined && plan.organiserUserId === home.me;
  // Null is "nobody yet" — a quiet ask that opened (spec §5.4) — and is not
  // the same as an organiser who has since left the circle.
  const organiserName =
    plan.organiserUserId === null
      ? null
      : home.members.find((m) => m.userId === plan.organiserUserId)?.name;
  const params = { id, planId: plan.id };

  return (
    <PlanInProgressScreen
      circleName={home.name}
      planTitle={plan.title}
      closes={t('circleHome', 'replies_close', {
        deadline: whenWords(plan.responseDeadline, home.zone),
      })}
      replied={t('circleHome', 'replied', { count: plan.replied, total: plan.asked })}
      canEdit={canEdit}
      canCancel={canEdit || home.isOwner}
      organiserName={organiserName}
      onEdit={() => router.push({ pathname: '/circles/[id]/plan/[planId]/edit', params })}
      onCancel={() => router.push({ pathname: '/circles/[id]/plan/[planId]/cancel', params })}
      onSeeHowItsLooking={() =>
        router.push({ pathname: '/circles/[id]/plan/[planId]/candidates', params })
      }
      onBack={onBack}
    />
  );
}
