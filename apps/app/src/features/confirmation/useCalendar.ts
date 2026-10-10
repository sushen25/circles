import type { CircleId, PlanId } from '@circles/contracts';
import { useRef, useState } from 'react';
import { Platform } from 'react-native';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { calendarFile } from '../../data/confirmation';
import { currentDevice, type Device } from '../../platform/device';
import { saveFile } from '../../platform/download';
import { isOffline } from '../identity/join/failure';

/**
 * The add-to-calendar sheet's state, and the download behind its one row.
 *
 * **The file is fetched when the confirmed screen loads (`prepare`), not when
 * the sheet opens,** so the common case opens on a ready row. Mobile Safari
 * hands a download to Calendar only from a tap it can see, and a tap followed
 * by a network round trip is, by the time the file arrives, no longer one. So
 * the row is not tappable until the file is here, and a tap saves it
 * synchronously, inside the gesture. While it is not, the row says so
 * (`preparing`, then the shared "still working" line), and a failed fetch is
 * retried by "Try again" in the row (SUS-154).
 *
 * `calendar_add_opened` when the sheet opens and `ics_downloaded` only when a
 * file was actually handed over (spec §11.3) — the difference between the two
 * is how many people looked and did not add it.
 */
export type CalendarPhase = 'idle' | 'preparing' | 'ready' | 'failed';

export type Calendar = {
  open: boolean;
  phase: CalendarPhase;
  /** Why the fetch failed, in words, for the row. */
  problem: string | undefined;
  /** What the tap just did, in words: the next step on this device. */
  status: string | undefined;
  /** What the tap will do on this device, in words, for the ready row. */
  ready: string;
  /** Start fetching the file now; a no-op if it is here or on its way. */
  prepare: () => void;
  show: () => void;
  hide: () => void;
  download: () => void;
  retry: () => void;
};

export type CalendarTarget = {
  circleId: string;
  planId: string;
  confirmationId: string;
  /**
   * What the file says, as a key: the same confirmation edited (a new place or
   * note) is a different file, so a fetched one is only good for this version.
   */
  version: string;
  filename: string;
};

/** What the tap does, per device: `ready_ios`, `ready_android`, `ready_other`. */
function readyWords(device: Device): string {
  return t('addToCalendar', `ready_${device.kind}`);
}

/** The next step once the file is saved: in an in-app browser it may land nowhere. */
function savedWords(device: Device): string {
  return device.inApp
    ? t('addToCalendar', 'saved_in_app')
    : t('addToCalendar', `saved_${device.kind}`);
}

export function useCalendar(target: CalendarTarget | undefined): Calendar {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string>();
  /** Which version of the confirmation the phase is about: a moved or edited one is a different file. */
  const [state, setState] = useState<{
    key: string;
    phase: CalendarPhase;
    problem?: string;
    contents?: string;
  }>();
  /** The version the screen wants now; an answer for any other is obsolete and ignored. */
  const wanted = useRef<string | undefined>(undefined);
  const ids =
    target === undefined
      ? {}
      : { circle_id: target.circleId as CircleId, plan_id: target.planId as PlanId };

  const key = target?.version;
  const mine = state !== undefined && state.key === key ? state : undefined;
  const phase: CalendarPhase = mine?.phase ?? 'idle';

  const fetchFile = (confirmationId: string, version: string) => {
    wanted.current = version;
    setState({ key: version, phase: 'preparing' });
    calendarFile(confirmationId)
      .then((contents) => {
        if (wanted.current === version) setState({ key: version, phase: 'ready', contents });
      })
      .catch(() => {
        if (wanted.current !== version) return;
        setState({
          key: version,
          phase: 'failed',
          problem: isOffline() ? t('addToCalendar', 'offline') : t('addToCalendar', 'failed'),
        });
      });
  };

  const prepare = () => {
    // Asked already for this version (a second caller in the same render, say).
    if (target === undefined || phase !== 'idle' || wanted.current === target.version) return;
    // A failure is not retried on its own; the row's "Try again" does it.
    fetchFile(target.confirmationId, target.version);
  };

  return {
    open,
    phase,
    problem: mine?.problem,
    status,
    ready: readyWords(currentDevice()),
    prepare,
    show: () => {
      setStatus(undefined);
      setOpen(true);
      track('calendar_add_opened', {
        ...ids,
        surface: Platform.OS === 'web' ? 'web' : 'native',
      });
      // The confirmed screen has usually fetched it already.
      prepare();
    },
    hide: () => setOpen(false),
    retry: () => {
      if (target === undefined) return;
      setStatus(undefined);
      fetchFile(target.confirmationId, target.version);
    },
    download: () => {
      if (target === undefined) return;
      const contents = mine?.contents;
      // Not here yet: the row is busy or offering a retry, and says so.
      if (phase !== 'ready' || contents === undefined) return;
      setStatus(undefined);
      // Synchronously, inside the tap.
      const saved = saveFile(contents, target.filename, 'text/calendar;charset=utf-8');
      if (saved === 'saved') {
        track('ics_downloaded', ids);
        setStatus(savedWords(currentDevice()));
      } else {
        setStatus(
          saved === 'unsupported'
            ? t('addToCalendar', 'unsupported')
            : t('addToCalendar', 'save_failed'),
        );
      }
    },
  };
}
