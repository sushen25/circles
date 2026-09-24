import { useRouter } from 'expo-router';

import { t } from '../../copy';
import type { PlanConfirmation } from '../../data/confirmation';
import { Placeholder } from '../scheduling/parts';
import { attendanceStageOf, outcomeStageOf } from './morningAfter';

/**
 * The confirmed screen once its meetup has ended (S1-28's `past`), with the way
 * into the morning after when the reader still owes it (S1-29): the organiser's
 * "Did it happen?" until they report, a member's "Were you there?" until they
 * answer. The plan's own link, from the chat or an old email, lands here the
 * morning after, and "there is nothing left to decide" was only true for
 * somebody with nothing left to say.
 */
export function PastMeetup({ data, onBack }: { data: PlanConfirmation; onBack: () => void }) {
  const router = useRouter();

  const action = (() => {
    if (data.isOrganiser) {
      if (outcomeStageOf(data) !== 'ask') return undefined;
      return {
        actionLabel: t('outcome', 'past_action'),
        onAction: () =>
          router.push({
            pathname: '/circles/[id]/plan/[planId]/outcome',
            params: { id: data.circleId, planId: data.planId },
          }),
      };
    }
    const stage = attendanceStageOf(data);
    if (stage.kind !== 'ask' || stage.said !== undefined) return undefined;
    return {
      actionLabel: t('wasThere', 'past_action'),
      onAction: () =>
        router.push({ pathname: '/p/[code]/attendance', params: { code: data.code } }),
    };
  })();

  return (
    <Placeholder
      topTitle={data.circleName}
      message={t('confirmedOrg', 'past_title')}
      detail={action === undefined ? t('confirmedOrg', 'past_body') : undefined}
      onBack={onBack}
      {...action}
    />
  );
}
