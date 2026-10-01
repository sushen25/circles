import { useEffect, useMemo, useRef } from 'react';
import { PanResponder, Platform, type LayoutChangeEvent, type View } from 'react-native';

import { type DayBox, dayAt } from './dayGridStroke';

/**
 * Painting by drag (ADR 00ZZ): a stroke that starts on a day hands the grid's
 * index of each day the finger reaches. What a stroke *does* is the caller's —
 * plan setup's picker fills in calendar order — and the grid only says where
 * the finger is.
 */
export type GridPaint = {
  begin: (index: number) => void;
  extend: (index: number) => void;
  end: () => void;
};

/**
 * The drag, built the way `Track`'s is (ADR 0009): one `PanResponder`,
 * created once so a re-render cannot interrupt a stroke; taps left to the day
 * buttons; and the stroke claimed only when a move is mostly sideways. A drag
 * that starts vertically is the page scrolling, and a finger cannot mean both.
 * Once a stroke is the grid's it keeps it, so the finger may then go down
 * through the weeks; on the web, `touch-action: pan-y` tells the browser the
 * same thing, so a sideways start never scrolls and a vertical one always does.
 *
 * Each day's box is recorded as it lays out, relative to the grid, and the
 * grid's own place on screen is measured when a stroke begins: a stroke
 * crosses rows, so the point is turned into a day in two dimensions
 * (`dayAt`).
 */
export function useDayStroke(paint: GridPaint | undefined, dayCount: number) {
  const ref = useRef<View>(null);
  const boxes = useRef<(DayBox | undefined)[]>([]);
  const weekTops = useRef<number[]>([]);
  const dayRows = useRef<
    ({ week: number; x: number; width: number; height: number } | undefined)[]
  >([]);
  // The grid's top-left in the same coordinates as the gesture, once measured.
  const origin = useRef<{ x: number; y: number } | undefined>(undefined);
  const last = useRef<number | undefined>(undefined);
  const pending = useRef<{ x: number; y: number } | undefined>(undefined);
  const live = useRef({ paint, dayCount });
  useEffect(() => {
    live.current = { paint, dayCount };
  }, [paint, dayCount]);
  // Set as a stroke ends and cleared once the events of that moment are over,
  // so the click a mouse makes on release is not also a tap.
  const stroked = useRef(false);

  const rebuild = () => {
    boxes.current = dayRows.current.map((day) =>
      day === undefined
        ? undefined
        : { x: day.x, y: weekTops.current[day.week] ?? 0, width: day.width, height: day.height },
    );
  };

  /* eslint-disable react-hooks/refs -- as in `Track`: PanResponder stores these
     and calls them from touch events, never during render. */
  const responder = useMemo(() => {
    const at = (x: number, y: number): number | undefined => {
      const from = origin.current;
      if (from === undefined) return undefined;
      // Only the days showing: a box from a longer month laid out earlier is
      // not a day any more (review round 2).
      return dayAt({ x: x - from.x, y: y - from.y }, boxes.current.slice(0, live.current.dayCount));
    };
    const reach = (x: number, y: number) => {
      const index = at(x, y);
      if (index === undefined || index === last.current) return;
      if (last.current === undefined) live.current.paint?.begin(index);
      else live.current.paint?.extend(index);
      last.current = index;
    };
    const finish = () => {
      if (last.current !== undefined) {
        live.current.paint?.end();
        stroked.current = true;
        setTimeout(() => {
          stroked.current = false;
        }, 0);
      }
      last.current = undefined;
      pending.current = undefined;
    };
    return PanResponder.create({
      // A tap belongs to the day under it; only a sideways drag is ours.
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (_, gesture) => {
        last.current = undefined;
        origin.current = undefined;
        pending.current = { x: gesture.moveX, y: gesture.moveY };
        const start = { x: gesture.x0, y: gesture.y0 };
        ref.current?.measure((_x, _y, _w, _h, pageX, pageY) => {
          // React Native's measure is in window coordinates, as the gesture
          // is. react-native-web's is in the viewport's and its gesture in the
          // document's, so the page's own scroll makes up the difference.
          const scroll =
            Platform.OS === 'web' && typeof window !== 'undefined'
              ? { x: window.scrollX, y: window.scrollY }
              : { x: 0, y: 0 };
          origin.current = { x: pageX + scroll.x, y: pageY + scroll.y };
          reach(start.x, start.y);
          const now = pending.current;
          if (now !== undefined) reach(now.x, now.y);
        });
      },
      onPanResponderMove: (_, gesture) => {
        pending.current = { x: gesture.moveX, y: gesture.moveY };
        reach(gesture.moveX, gesture.moveY);
      },
      onPanResponderRelease: () => finish(),
      onPanResponderTerminate: () => finish(),
    });
  }, []);
  /* eslint-enable react-hooks/refs */

  if (paint === undefined) return undefined;
  return {
    ref,
    swallowsClick: () => stroked.current,
    handlers: responder.panHandlers,
    placeWeek: (week: number, event: LayoutChangeEvent) => {
      weekTops.current[week] = event.nativeEvent.layout.y;
      rebuild();
    },
    placeDay: (index: number, week: number, event: LayoutChangeEvent) => {
      const { x, width, height } = event.nativeEvent.layout;
      dayRows.current[index] = { week, x, width, height };
      rebuild();
    },
  };
}
