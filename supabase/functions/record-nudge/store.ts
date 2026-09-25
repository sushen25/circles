import { NUDGE_STATE_COLUMNS, type NudgeStateRow, nudgeRecordOf } from '@circles/contracts';
import type { NudgeMoment, NudgeRecord } from '@circles/domain';

import type { Db } from '../_shared/db.ts';

/**
 * What `record-nudge` reads and writes, as the caller.
 *
 * **Every call goes through `caller`**, the client carrying the requester's
 * JWT, so RLS is the authority on whose rows these are: `nudge_states` is own
 * rows only, and a plan-bound row only for a plan in one's own circles
 * (`nudge_states_insert_own`). Nothing here needs the service role, and so
 * nothing here could write a row the person could not have written directly.
 *
 * An interface so that the decision in `record.ts` can be tested without a
 * database; `callerStore` is the one implementation.
 */
export interface NudgeStore {
  /** The plan is one the caller can see: in one of their circles. */
  planVisible(planId: string): Promise<boolean>;
  /** The caller's rows, every moment. A person has at most a few dozen. */
  history(): Promise<NudgeRecord[]>;
  /** `after_attendance_facts`, or undefined when the plan is not theirs to ask about. */
  afterAttendance(
    planId: string,
  ): Promise<{ attended: boolean; firstInCircle: boolean } | undefined>;
  /** Records it as shown. False when a row was already there: somebody got there first. */
  recordShown(moment: NudgeMoment, planId: string | null): Promise<boolean>;
  /** Records the answer, on the shown row or, failing that, a new one. */
  recordAnswer(
    moment: NudgeMoment,
    planId: string | null,
    answer: 'dismissed' | 'tapped',
  ): Promise<void>;
}

export function callerStore(caller: Db, userId: string): NudgeStore {
  const own = () => caller.from('nudge_states');

  return {
    async planVisible(planId) {
      const { data, error } = await caller
        .from('plans')
        .select('id')
        .eq('id', planId)
        .maybeSingle();
      if (error !== null) throw error;
      return data !== null;
    },

    async history() {
      const { data, error } = await own().select(NUDGE_STATE_COLUMNS).eq('user_id', userId);
      if (error !== null) throw error;
      return ((data ?? []) as NudgeStateRow[]).flatMap((row) => nudgeRecordOf(row) ?? []);
    },

    async afterAttendance(planId) {
      const { data, error } = await caller.rpc('after_attendance_facts', { p_plan_id: planId });
      if (error !== null) throw error;
      const row = (data as { attended: boolean; first_in_circle: boolean }[] | null)?.[0];
      return row === undefined
        ? undefined
        : { attended: row.attended, firstInCircle: row.first_in_circle };
    },

    async recordShown(moment, planId) {
      // `on conflict do nothing`: the unique key is once per moment per plan,
      // and a second device asking at the same moment is told no rather than
      // both being told yes.
      const { data, error } = await own()
        .upsert(
          { user_id: userId, moment, plan_id: planId },
          { onConflict: 'user_id,moment,plan_id', ignoreDuplicates: true },
        )
        .select('id');
      if (error !== null) throw error;
      return (data ?? []).length > 0;
    },

    async recordAnswer(moment, planId, answer) {
      const match = own().update({ answer }).eq('user_id', userId).eq('moment', moment);
      const { data, error } = await (
        planId === null ? match.is('plan_id', null) : match.eq('plan_id', planId)
      ).select('id');
      if (error !== null) throw error;
      if ((data ?? []).length > 0) return;

      // Answered with no row to answer: the question's response was lost, or
      // it was asked on a build that did not ask. The answer is still the
      // person's, and it is what the back-off counts.
      const inserted = await own().upsert(
        { user_id: userId, moment, plan_id: planId, answer },
        { onConflict: 'user_id,moment,plan_id', ignoreDuplicates: true },
      );
      if (inserted.error !== null) throw inserted.error;
    },
  };
}
