import type { CircleId, PlanId } from '@circles/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { editConfirmation, stretchOf } from '../../data/confirmation';
import { FunctionError } from '../../data/functions';
import { isOffline } from '../identity/join/failure';

/**
 * Saving an edit to a locked-in plan (ADR 0051), and every way that can be
 * refused.
 *
 * A **move** is checked twice, like locking in a time of one's own: who the new
 * time works for is read again at the tap, and nothing is sent if an answer has
 * landed since the names on screen; then `expected_input_version` closes the
 * window to the server's lock. A place or note alone freezes no names and sends
 * no version. Refusals are read from `Problem.reason`, never the message.
 */

class NamesMoved extends Error {}

export type SaveInput = {
  circleId: string;
  invitedCount: number;
  /** Both for a move; neither for a place or note alone. */
  startsAt: string | undefined;
  endsAt: string | undefined;
  /** The plan's input version as the names on screen were read. */
  expectedInputVersion: number | undefined;
  placeName: string | undefined;
  placeUrl: string | undefined;
  note: string | undefined;
};

export type EditLockedSave = {
  busy: boolean;
  problem: string | undefined;
  /** An answer landed since the names on screen: they are being read again. */
  moved: boolean;
  save: (input: SaveInput) => void;
};

function problemOf(error: unknown): { problem: string; moved?: boolean } {
  if (isOffline()) return { problem: t('editLocked', 'youre_offline') };
  if (error instanceof NamesMoved) return { problem: t('editLocked', 'moved'), moved: true };
  if (!(error instanceof FunctionError)) return { problem: t('editLocked', 'problem_generic') };
  switch (error.reason) {
    case 'stale_availability':
      return { problem: t('editLocked', 'moved'), moved: true };
    case 'meetup_has_ended':
      return { problem: t('editLocked', 'ended') };
    case 'own_time_in_the_past':
    case 'own_time_off_the_half_hour':
    case 'own_time_ends_before_it_starts':
    case 'own_time_too_short':
    case 'own_time_too_long':
    case 'own_time_too_far_ahead':
    case 'needs_own_time':
      return { problem: t('editLocked', 'gone') };
    case 'not_the_organiser':
      return { problem: t('editLocked', 'not_organiser') };
    case 'nothing_to_change':
      return { problem: t('editLocked', 'nothing') };
    case 'plan_not_found':
      return { problem: t('candidates', 'denied_title') };
    default:
      return error.reference === undefined
        ? { problem: t('editLocked', 'problem_generic') }
        : { problem: t('editLocked', 'problem_reference', { reference: error.reference }) };
  }
}

export function useEditLocked({
  planId,
  onSaved,
}: {
  planId: string;
  onSaved: () => void;
}): EditLockedSave {
  const client = useQueryClient();
  const [problem, setProblem] = useState<string>();
  const [moved, setMoved] = useState(false);

  const saving = useMutation({
    mutationFn: async (input: SaveInput) => {
      if (input.startsAt !== undefined && input.endsAt !== undefined) {
        const now = await stretchOf(planId, input.startsAt, input.endsAt);
        if (now.inputVersion !== input.expectedInputVersion) throw new NamesMoved();
      }
      return editConfirmation({
        planId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        expectedInputVersion: input.expectedInputVersion,
        placeName: input.placeName,
        placeUrl: input.placeUrl,
        note: input.note,
      });
    },
    onSuccess: (saved, input) => {
      const ids = { circle_id: input.circleId as CircleId, plan_id: planId as PlanId };
      if (input.startsAt === undefined) {
        track('confirmation_edited', ids);
      } else {
        track('meetup_moved', {
          ...ids,
          attending_count: saved.going.length,
          invited_count: input.invitedCount,
        });
      }
      setProblem(undefined);
      setMoved(false);
      void client.invalidateQueries();
      onSaved();
    },
    onError: (error) => {
      const read = problemOf(error);
      setProblem(read.problem);
      setMoved(read.moved === true);
      void Promise.all([
        client.invalidateQueries({ queryKey: ['plan-candidates', planId] }),
        client.invalidateQueries({ queryKey: ['stretch', planId] }),
      ]);
    },
  });

  return {
    busy: saving.isPending,
    problem,
    moved,
    save: (input) => {
      setProblem(undefined);
      saving.mutate(input);
    },
  };
}
