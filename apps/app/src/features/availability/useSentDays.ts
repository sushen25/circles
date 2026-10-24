import { dayFreeCount, fromISO, toLocal, zone as toZone, type LocalDate } from '@circles/domain';
import { useQuery } from '@tanstack/react-query';

import { othersSaid, type AnswerablePlan, type OwnAnswer } from '../../data/availability';
import { counted, dayLabel } from './others';
import { dateWords } from './days';
import type { SentDay } from './DayChips';

/**
 * The days a guest sent, each with how many can make it, themselves included
 * (SUS-250, ADR 0066). The counts are the editor's own read, `othersSaid`, and
 * show only above its threshold; a failed or slow read leaves the days with no
 * figure rather than a wrong one. Only an answer with times has days: "I'm easy"
 * and the three "none of these" answers do not.
 */
export function useSentDays(input: {
  plan: AnswerablePlan;
  answer: OwnAnswer | null;
  userId: string | undefined;
  live: boolean;
}): readonly SentDay[] {
  const { plan, answer, userId, live } = input;
  const read = useQuery({
    queryKey: ['others-said', plan.id, plan.revision, userId, 'sent'],
    queryFn: async () => (await othersSaid(plan.id)) ?? null,
    enabled: live && userId !== undefined && plan.acceptingAnswers && answer?.status === 'windows',
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  if (answer === null || answer.status !== 'windows') return [];

  const zone = toZone(plan.zone);
  const dates = new Set<LocalDate>();
  for (const span of answer.windows) dates.add(toLocal(fromISO(span.start), zone).date);
  const others = counted(read.data ?? undefined);

  return [...dates].sort().map((date) => {
    const short = dateWords(date, 'short');
    const long = dateWords(date, 'long');
    const free = others === undefined ? undefined : dayFreeCount(others, date);
    return {
      key: date,
      label: short,
      count: free === undefined ? undefined : free + 1,
      spoken: free === undefined ? long : dayLabel(long, free, true),
    };
  });
}
