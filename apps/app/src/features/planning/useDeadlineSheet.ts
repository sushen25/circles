import { fromISO, localDate, type Instant } from '@circles/domain';
import { useState } from 'react';

import { t } from '../../copy';
import { dayName } from '../availability/days';
import {
  allowedAt,
  deadlineAt,
  deadlineChoices,
  deadlineDays,
  deadlineParts,
  stepMinutes,
} from './deadlines';
import type { DeadlineSheetProps } from './sheets';
import { whenWords } from './when';
import { deadlineChoiceLabel, timeWords } from './words';

/**
 * The replies-close sheet's state: which quick choice is on, and the day and
 * half hour being picked by hand. Everything it offers is inside
 * `[now, last possible start]` and nothing narrows that (spec §5.3).
 */
export function useDeadlineSheet({
  now,
  latestStart,
  zone,
  current,
  onPick,
}: {
  now: Instant;
  /** Undefined while the form cannot be resolved: there is nothing to bound. */
  latestStart: string | undefined;
  zone: string;
  current: string | undefined;
  onPick: (deadline: string) => void;
}): { open: () => void; props: DeadlineSheetProps | undefined } {
  const [visible, setVisible] = useState(false);
  const [picked, setPicked] = useState<{ day: string; minutes: number }>();

  if (latestStart === undefined) return { open: () => undefined, props: undefined };

  const start = picked ?? deadlineParts(current ?? latestStart, zone);
  const pickedIso = deadlineAt(start.day, start.minutes, zone);
  const choose = (at: string) => {
    onPick(at);
    setVisible(false);
  };
  const choices = deadlineChoices(now, latestStart);

  return {
    open: () => {
      setPicked(undefined);
      setVisible(true);
    },
    props: {
      visible,
      choices: choices.map((c) => ({
        key: c.choice,
        label: deadlineChoiceLabel(c.choice),
        detail: whenWords(c.at, zone),
        selected: current !== undefined && fromISO(current) === fromISO(c.at),
      })),
      onChoose: (key) => {
        const choice = choices.find((c) => c.choice === key);
        if (choice !== undefined) choose(choice.at);
      },
      days: deadlineDays(now, latestStart, zone).map((day) => ({
        key: day,
        label: dayName(localDate(day)),
        selected: day === start.day,
      })),
      onDay: (day) => setPicked({ day, minutes: start.minutes }),
      time: timeWords(start.minutes),
      canEarlier: stepMinutes(start.minutes, -1) !== start.minutes,
      canLater: stepMinutes(start.minutes, 1) !== start.minutes,
      onEarlier: () => setPicked({ day: start.day, minutes: stepMinutes(start.minutes, -1) }),
      onLater: () => setPicked({ day: start.day, minutes: stepMinutes(start.minutes, 1) }),
      pickedAllowed: allowedAt(pickedIso, latestStart, now),
      onUsePicked: () => choose(pickedIso),
      latestNote: t('planSetup', 'deadline_latest_note', {
        deadline: whenWords(latestStart, zone),
      }),
      onDismiss: () => setVisible(false),
    },
  };
}
