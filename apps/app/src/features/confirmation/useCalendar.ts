import type { CircleId, PlanId } from '@circles/contracts';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { calendarFile, calendarLink } from '../../data/confirmation';
import { currentDevice, type Device } from '../../platform/device';
import { openLink, saveFile } from '../../platform/download';
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

/**
 * What the tap does, per device: `ready_ios`, `ready_android`, `ready_other`,
 * and on an iPhone with a link, which the phone opens itself, "Opens your
 * Calendar" (ADR 0063).
 */
function readyWords(device: Device, link: boolean): string {
  if (link && device.kind === 'ios') return t('addToCalendar', 'ready_link_ios');
  return t('addToCalendar', `ready_${device.kind}`);
}

/** The next step once the file is saved: in an in-app browser it may land nowhere. */
function savedWords(device: Device, link: boolean): string {
  if (link && device.kind === 'ios' && !device.inApp) return t('addToCalendar', 'saved_link_ios');
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
    /** The file itself, when it was fetched with the bearer (no link, or an in-app browser). */
    contents?: string;
    /** A link to the file with a 15-minute token in it (ADR 0063): held in memory, never anywhere else. */
    link?: { url: string; expiresAt: number };
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

  /**
   * A link where one can be made and followed (a browser that is not an in-app
   * one), the file fetched with the bearer where not. A deployment with no key
   * answers "no link", and that is the same fall back.
   */
  const fetchReady = async (confirmationId: string) => {
    const device = currentDevice();
    if (Platform.OS === 'web' && !device.inApp) {
      const link = await calendarLink(confirmationId);
      if (link !== null) return { link };
    }
    return { contents: await calendarFile(confirmationId) };
  };

  const fetchFile = (confirmationId: string, version: string) => {
    wanted.current = version;
    setState({ key: version, phase: 'preparing' });
    fetchReady(confirmationId)
      .then((ready) => {
        if (wanted.current === version) setState({ key: version, phase: 'ready', ...ready });
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

  // A link is good for 15 minutes and the screen can stay open longer: take a
  // fresh one a minute before it runs out, without the row changing. A refresh
  // that fails changes nothing; the tap notices an expired link and starts again.
  const expiresAt = mine?.link?.expiresAt;
  const confirmationId = target?.confirmationId;
  useEffect(() => {
    if (expiresAt === undefined || confirmationId === undefined || key === undefined) {
      return undefined;
    }
    const id = setTimeout(
      () => {
        calendarLink(confirmationId)
          .then((link) => {
            if (link !== null && wanted.current === key) {
              setState((now) =>
                now !== undefined && now.key === key && now.phase === 'ready'
                  ? { ...now, link }
                  : now,
              );
            }
          })
          .catch(() => undefined);
      },
      Math.max(0, expiresAt - Date.now() - 60_000),
    );
    return () => clearTimeout(id);
  }, [expiresAt, confirmationId, key]);

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
    ready: readyWords(currentDevice(), mine?.link !== undefined),
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
      // Not here yet: the row is busy or offering a retry, and says so.
      if (phase !== 'ready' || mine === undefined) return;
      const { link, contents } = mine;
      if (link === undefined && contents === undefined) return;
      // A link that has run out (a phone that slept through its refresh) is
      // not followed: it would be a refusal page. Get a new one, and say so by
      // the row going busy; the next tap follows it.
      if (link !== undefined && Date.now() >= link.expiresAt - 10_000) {
        setStatus(undefined);
        fetchFile(target.confirmationId, target.version);
        return;
      }
      setStatus(undefined);
      // Synchronously, inside the tap.
      const saved =
        link !== undefined
          ? openLink(link.url)
          : saveFile(contents ?? '', target.filename, 'text/calendar;charset=utf-8');
      if (saved === 'saved') {
        track('ics_downloaded', ids);
        setStatus(savedWords(currentDevice(), link !== undefined));
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
