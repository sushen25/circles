import { useRef } from 'react';

import type { GridPaint } from '../../components';
import { applyStroke, toggleDay } from './calendar';

/**
 * The taps and strokes on the first run's day grid (ADR 0047's picker, now the
 * organiser's own answer): a tap toggles a day, and a drag from a day paints
 * every day it crosses, in calendar order, with the opposite of what the first
 * day was, so dragging back gives days back. Nothing animates: a day answers
 * the finger the moment it is touched (manifesto §5.5).
 *
 * The picked days belong to the flow, which writes them to the draft; this
 * only decides what a touch means. A day outside `days` is never touched.
 */
export function useEveningPicks(
  days: readonly string[],
  picked: readonly string[],
  setPicked: (next: string[]) => void,
): { onDay: (index: number) => void; paint: GridPaint } {
  const stroke = useRef<{ anchor: string; paint: boolean; base: readonly string[] } | undefined>(
    undefined,
  );
  const inWindow = new Set(days);
  const pickable = (date: string) => inWindow.has(date);

  return {
    onDay: (index) => {
      const date = days[index];
      if (date !== undefined) setPicked(toggleDay(picked, date));
    },
    paint: {
      begin: (index) => {
        const date = days[index];
        if (date === undefined) {
          stroke.current = undefined;
          return;
        }
        const paint = !picked.includes(date);
        stroke.current = { anchor: date, paint, base: picked };
        setPicked(applyStroke(picked, date, date, paint, pickable));
      },
      extend: (index) => {
        const date = days[index];
        const current = stroke.current;
        if (date === undefined || current === undefined) return;
        setPicked(applyStroke(current.base, current.anchor, date, current.paint, pickable));
      },
      end: () => {
        stroke.current = undefined;
      },
    },
  };
}
