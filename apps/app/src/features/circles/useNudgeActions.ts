import { fromISO, snoozeAMonth, toISO, zone } from '@circles/domain';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { t } from '../../copy';
import type { CircleHome } from '../../data/circles';
import { saveMySwitches, updateCircle } from '../../data/circles/settings';

/**
 * The about-time card's two quieter answers (spec §5.9, S2-04): **Snooze a
 * month** and **Turn off nudges**.
 *
 * - **Snooze** is the owner's: it is a setting of the circle, written through
 *   `circles_update_owner` like cadence and the nudge policy, and a member's
 *   write would match no row. It moves `cadence_snoozed_until` a calendar
 *   month on (`snoozeAMonth`) and nothing else — the due date is the domain's,
 *   from when the circle last met, so the rhythm does not slip.
 * - **Turn off nudges** is the reader's own "Nudges to plan the next one" for
 *   this circle, the switch notification settings holds. Offered while it is
 *   on; once it is off the dispatcher skips them (`nudgeChoice`).
 *
 * Each handler is undefined when the reader cannot use it, which is how the
 * screen knows not to draw the button.
 */
export function useNudgeActions(home: CircleHome): {
  onSnoozeAMonth: (() => void) | undefined;
  onTurnOffNudges: (() => void) | undefined;
  notice: string | undefined;
} {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | undefined>();
  const inFlight = useRef(false);

  const run = async (write: () => Promise<void>, done: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setNotice(undefined);
    try {
      await write();
      setNotice(done);
      await queryClient.invalidateQueries({ queryKey: ['circle-home', home.id] });
    } catch {
      setNotice(t('circleHome', 'couldnt_save_nudge'));
    } finally {
      inFlight.current = false;
    }
  };

  const snooze = () =>
    void run(
      () =>
        updateCircle(home.id, {
          cadenceSnoozedUntil: toISO(
            snoozeAMonth(fromISO(new Date().toISOString()), zone(home.zone)),
          ),
        }),
      t('circleHome', 'snoozed', { circle: home.name }),
    );
  const turnOff = () =>
    void run(
      () => saveMySwitches(home.id, { mutedNudges: true }),
      t('circleHome', 'nudges_off', { circle: home.name }),
    );

  return {
    onSnoozeAMonth: home.isOwner ? snooze : undefined,
    onTurnOffNudges: home.mine !== null && !home.mine.mutedNudges ? turnOff : undefined,
    notice,
  };
}
