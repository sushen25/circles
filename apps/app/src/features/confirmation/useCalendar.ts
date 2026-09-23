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
 * **The file is fetched when the sheet opens, not when the row is tapped.**
 * Mobile Safari hands a download to Calendar only from a tap it can see, and a
 * tap followed by a network round trip is, by the time the file arrives, no
 * longer one. Fetched first, the tap saves it in the same turn; a tap that
 * beats the fetch waits for it and saves then, which every other browser
 * allows.
 *
 * `calendar_add_opened` when the sheet opens and `ics_downloaded` only when a
 * file was actually handed over (spec §11.3) — the difference between the two
 * is how many people looked and did not add it.
 */
export type Calendar = {
  open: boolean;
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
  const file = useRef<{ id: string; contents: Promise<string> } | undefined>(undefined);
  const ids =
    target === undefined
      ? {}
      : { circle_id: target.circleId as CircleId, plan_id: target.planId as PlanId };

  /** One fetch per confirmation: a rescheduled meetup is a different file. */
  const fetched = (id: string): Promise<string> => {
    if (file.current?.id !== id) {
      const contents = calendarFile(id);
      // A failed fetch is retried by the next tap rather than remembered.
      contents.catch(() => {
        if (file.current?.contents === contents) file.current = undefined;
      });
      file.current = { id, contents };
    }
    return file.current.contents;
  };

  const handOver = (contents: string, filename: string) => {
    const saved = saveFile(contents, filename, 'text/calendar;charset=utf-8');
    if (saved === 'saved') {
      track('ics_downloaded', ids);
      setStatus(t('addToCalendar', 'saved'));
    } else {
      setStatus(
        saved === 'unsupported' ? t('addToCalendar', 'unsupported') : t('addToCalendar', 'failed'),
      );
    }
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
      if (target !== undefined) void fetched(target.confirmationId).catch(() => undefined);
    },
    hide: () => setOpen(false),
    download: () => {
      if (target === undefined || busy) return;
      setStatus(undefined);
      setBusy(true);
      fetched(target.confirmationId)
        .then((contents) => handOver(contents, target.filename))
        .catch(() => {
          setStatus(isOffline() ? t('addToCalendar', 'offline') : t('addToCalendar', 'failed'));
        })
        .finally(() => setBusy(false));
    },
  };
}
