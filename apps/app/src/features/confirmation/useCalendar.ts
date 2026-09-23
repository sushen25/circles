import type { CircleId, PlanId } from '@circles/contracts';
import { useRef, useState } from 'react';
import { Platform } from 'react-native';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { calendarFile } from '../../data/confirmation';
import { saveFile } from '../../platform/download';
import { isOffline } from '../identity/join/failure';

/**
 * The add-to-calendar sheet's state, and the download behind its one row.
 *
 * **The file is fetched when the sheet opens, and the row waits for it.**
 * Mobile Safari hands a download to Calendar only from a tap it can see, and a
 * tap followed by a network round trip is, by the time the file arrives, no
 * longer one. So the row is not tappable until the file is here, and a tap
 * saves it synchronously, inside the gesture. A fetch that failed is retried
 * by the next tap, which then waits again rather than saving late.
 *
 * `calendar_add_opened` when the sheet opens and `ics_downloaded` only when a
 * file was actually handed over (spec §11.3) — the difference between the two
 * is how many people looked and did not add it.
 */
export type Calendar = {
  open: boolean;
  /** The file is on its way; the row is not tappable yet. */
  busy: boolean;
  status: string | undefined;
  show: () => void;
  hide: () => void;
  download: () => void;
};

export type CalendarTarget = {
  circleId: string;
  planId: string;
  confirmationId: string;
  filename: string;
};

export function useCalendar(target: CalendarTarget | undefined): Calendar {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>();
  /** The file, once it is here — per confirmation: a rescheduled meetup is a different file. */
  const file = useRef<{ id: string; contents: string } | undefined>(undefined);
  const ids =
    target === undefined
      ? {}
      : { circle_id: target.circleId as CircleId, plan_id: target.planId as PlanId };

  const fetchFile = (id: string) => {
    setBusy(true);
    calendarFile(id)
      .then((contents) => {
        file.current = { id, contents };
      })
      .catch(() => {
        setStatus(isOffline() ? t('addToCalendar', 'offline') : t('addToCalendar', 'failed'));
      })
      .finally(() => setBusy(false));
  };

  return {
    open,
    busy,
    status,
    show: () => {
      setStatus(undefined);
      setOpen(true);
      track('calendar_add_opened', {
        ...ids,
        surface: Platform.OS === 'web' ? 'web' : 'native',
      });
      if (target !== undefined && file.current?.id !== target.confirmationId && !busy) {
        fetchFile(target.confirmationId);
      }
    },
    hide: () => setOpen(false),
    download: () => {
      if (target === undefined || busy) return;
      setStatus(undefined);
      const ready = file.current?.id === target.confirmationId ? file.current : undefined;
      if (ready === undefined) {
        fetchFile(target.confirmationId);
        return;
      }
      // Synchronously, inside the tap.
      const saved = saveFile(ready.contents, target.filename, 'text/calendar;charset=utf-8');
      if (saved === 'saved') {
        track('ics_downloaded', ids);
        setStatus(t('addToCalendar', 'saved'));
      } else {
        setStatus(
          saved === 'unsupported'
            ? t('addToCalendar', 'unsupported')
            : t('addToCalendar', 'failed'),
        );
      }
    },
  };
}
