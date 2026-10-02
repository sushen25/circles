import { windowError, windowFromDays, type DateWindow, type LocalDate } from '@circles/domain';

import { toLocalDate } from '../_shared/moment.ts';
import { Refusal } from '../_shared/problem.ts';
import type { Db } from '../_shared/db.ts';

/**
 * What `revise-plan` reads before it decides: the plan, the required list it
 * would replace, the days somebody picked, and the window an edit would leave.
 * Apart from the handler so that each file stays one job (AGENTS.md 10).
 */

/**
 * The required list the request would set, or `undefined` if it is the list the
 * plan already has.
 *
 * A set comparison, on the revision the plan is on now — the one the rewrite
 * would replace. Two organisers editing at the same moment could each read
 * before the other writes; the cost of that is a redundant rewrite of identical
 * rows, which is what this is avoiding rather than what it is guarding.
 */
export async function changedRequiredMembers(
  caller: Db,
  planId: string,
  revision: number,
  sent: string[],
): Promise<string[] | undefined> {
  const { data, error } = await caller
    .from('plan_required_members')
    .select('user_id')
    .eq('plan_id', planId)
    .eq('revision', revision);
  if (error !== null) throw error;

  const current = (data ?? []).map((row) => row.user_id).sort();
  const wanted = [...sent].sort();
  const same =
    current.length === wanted.length && current.every((id, index) => id === wanted[index]);
  if (same) return undefined;

  // Required of somebody who was asked. `revise_plan` refuses this too, and that
  // is the enforcement; asking here is what lets a *preview* refuse it, which is
  // the whole difference between a preview and a guess.
  const { data: asked, error: askedError } = await caller
    .from('plan_participants')
    .select('user_id')
    .eq('plan_id', planId)
    .eq('revision', revision);
  if (askedError !== null) throw askedError;

  const participants = new Set((asked ?? []).map((row) => row.user_id));
  if (wanted.some((id) => !participants.has(id))) {
    throw new Refusal(
      'not_a_participant',
      'Somebody on that list was never asked, so they cannot answer.',
    );
  }
  return wanted;
}

/**
 * The window an edit would leave (ADR 0047). A window sent with its days is
 * those days; one sent without is every day from its start to its end — what
 * "Try a wider window" sends, dropping the gaps on purpose; none sent is the
 * plan's own. In the canonical form, so a list with no gap is the range.
 */
export function afterWindow(
  before: DateWindow,
  sent: { start: string; end: string; days?: string[] | undefined } | undefined,
): DateWindow {
  if (sent === undefined) return before;
  const start = toLocalDate(sent.start);
  const end = toLocalDate(sent.end);
  if (sent.days === undefined) return { start, end };
  const window = { start, end, days: sent.days.map(toLocalDate) };
  // Malformed is reported by `windowError` as it stands, not tidied into a
  // window the organiser did not pick.
  if (windowError(window) !== undefined) return window;
  return windowFromDays(window.days) ?? window;
}

/** The days somebody's answer to the current revision has times on. */
export async function pickedDays(caller: Db, planId: string): Promise<LocalDate[]> {
  const { data, error } = await caller.rpc('picked_days', { p_plan_id: planId });
  if (error !== null) throw error;
  return ((data ?? []) as string[]).map(toLocalDate);
}

export async function readPlan(
  caller: Db,
  planId: string,
): Promise<{
  window_start: string;
  window_end: string;
  plan_days: { day: string }[];
  daily_start_local: number;
  daily_end_local: number;
  duration_minutes: number;
  time_zone: string;
  quorum: number;
  response_deadline: string;
  revision: number;
  input_version: number;
  state: string;
}> {
  const { data, error } = await caller
    .from('plans')
    .select(
      'window_start, window_end, plan_days(day), daily_start_local, daily_end_local, duration_minutes, time_zone, quorum, response_deadline, revision, input_version, state',
    )
    .eq('id', planId)
    .maybeSingle();
  if (error !== null) throw error;
  if (data === null) throw new Refusal('plan_not_found', 'That plan is not there.');
  return data;
}
