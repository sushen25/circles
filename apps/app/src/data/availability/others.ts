import { fromISO, interval, type OthersSaid } from '@circles/domain';
import { z } from 'zod';

import { authClient } from '../auth/client';

/**
 * What the others have said about the plan being answered, for the counts on
 * the editor (SUS-129, ADR 0045), or `undefined` when there is nothing to say
 * to this person.
 *
 * One call, `public.others_availability`, because `plan_responses` and
 * `willing_windows` stay readable by their owner alone. The function decides
 * who may ask (an active member), what counts (the current revision, never
 * the reader's own) and the threshold; the domain works out every count from
 * what it returns (`freeFor`). Nothing here is stored or put in the draft: the
 * editor reads it again each time it opens.
 *
 * A malformed reply is treated as no reply. This is an optional read, like
 * the previous times (ADR 0037): it offers nothing rather than an error.
 */
const Window = z.object({ start: z.string(), end: z.string() });
const Reply = z.object({
  asked: z.number().int().nonnegative(),
  answered: z.number().int().nonnegative(),
  with_times: z.number().int().nonnegative(),
  flexible: z.number().int().nonnegative(),
  reader_answered: z.boolean(),
  days: z.array(z.array(Window)),
});

export async function othersSaid(planId: string): Promise<OthersSaid | undefined> {
  const { data, error } = await authClient().rpc('others_availability', { p_plan_id: planId });
  if (error !== null) throw new Error('others_availability failed');
  if (data === null) return undefined;
  const reply = Reply.safeParse(data);
  if (!reply.success) return undefined;
  return {
    asked: reply.data.asked,
    answered: reply.data.answered,
    withTimes: reply.data.with_times,
    flexible: reply.data.flexible,
    readerAnswered: reply.data.reader_answered,
    days: reply.data.days.map((windows) =>
      windows.map((w) => interval(fromISO(w.start), fromISO(w.end))),
    ),
  };
}
