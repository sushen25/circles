import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';

import { color, faceFor, hit, radius } from '@circles/tokens';

import { type DayBox, dayAt } from './dayGridStroke';
import { Icon } from './Icon';
import { Label } from './Text';
import { usePalette } from './theme';

/** The gap between days, where there is room for it. */
const GAP = 5;

/**
 * The plan's days as a calendar, Monday first: tap every day that could work,
 * then pick a time once for all of them (ADR 0024).
 *
 * Each day is a toggle button. Ticked is the accent fill **and** a check; a day
 * with times is the soft fill **and** its short tag ("Eve", "Some"); and the
 * spoken label carries the full date and the times in words, so nothing is
 * said by colour alone (manifesto §6).
 *
 * **Seven columns only while seven fit.** A column narrower than a 44pt target
 * at the current text size — 200% type, a browser zoomed to 200%, a narrow
 * phone — and the grid becomes a wrapping list of days that name their own
 * weekday, since the header above a column no longer lines up with anything.
 */
export type GridDay = {
  key: string;
  /** "14" */
  number: string;
  /** "Mon 14", shown instead of the number when the grid wraps. */
  name: string;
  /** "Eve", "Some" — only when the day has times. */
  tag?: string | undefined;
  /** "Monday 14 September, 5:30–10:30 pm" or "…, no times yet". */
  label: string;
  /** Days since the Monday of the first week: its place in the grid. */
  slot: number;
  selected: boolean;
  hasTimes: boolean;
  /**
   * How many others could make it, as a small figure with a people icon in the
   * day's top-left corner (SUS-129). The label carries it in words; the figure
   * is hidden from a screen reader. Absent on every day, the grid is as it was.
   */
  others?: string | undefined;
  /**
   * Shown, faded and not pressable: a day in the past on the plan setup's
   * calendar, or one past the thirty-day cap. Its label has to say why.
   */
  disabled?: boolean | undefined;
};

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

type Props = {
  days: readonly GridDay[];
  /** The seven column headings, Monday first. */
  weekdays: readonly string[];
  /** The grid's name for a screen reader. */
  label: string;
  onToggle?: ((index: number) => void) | undefined;
  /** "I'm easy" is on, or an answer is on its way: shown, faded, not pressable. */
  dimmed?: boolean | undefined;
  /**
   * Paint by dragging across days as well as tapping them (SUS-133). Absent,
   * the grid is exactly what it was: taps only, as the availability editor's.
   * Offered only while the grid is seven columns — wrapped into a list at
   * large text, its days are tapped one at a time.
   */
  onPaint?: GridPaint | undefined;
};

const COLUMNS = 7;

export function DayGrid({ days, weekdays, label, onToggle, dimmed = false, onPaint }: Props) {
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  // The gap gives way before the columns do: seven 44pt columns fit a 360pt
  // phone's content width with a point to spare between them, and a 390pt one
  // with the full gap. Before the first layout the width is unknown; seven
  // columns is what a phone at ordinary text size gets, and what a server
  // render should show.
  const column = hit * Math.max(1, fontScale);
  const gap = width > 0 ? Math.min(GAP, (width - COLUMNS * column) / (COLUMNS - 1)) : GAP;
  const wraps = gap < 1;
  // Room for the figure in the corner, on every day alike so the rows line up.
  const counted = days.some((day) => day.others !== undefined);
  const stroke = useStroke(onPaint !== undefined && !wraps && !dimmed ? onPaint : undefined);

  const button = (day: GridDay, index: number) => (
    <DayButton
      key={day.key}
      day={day}
      wraps={wraps}
      counted={counted}
      dimmed={dimmed}
      onPress={onToggle === undefined ? undefined : () => onToggle(index)}
      onLayout={
        stroke === undefined
          ? undefined
          : (event) => stroke.placeDay(index, Math.floor(day.slot / COLUMNS), event)
      }
    />
  );

  let body;
  if (wraps) {
    body = <View style={styles.wrap}>{days.map(button)}</View>;
  } else {
    const weeks = Math.ceil((Math.max(...days.map((d) => d.slot), 0) + 1) / COLUMNS);
    const bySlot = new Map(days.map((day, index) => [day.slot, index]));
    body = Array.from({ length: weeks }, (_, week) => (
      <View
        key={week}
        style={[styles.week, { gap }]}
        onLayout={stroke === undefined ? undefined : (event) => stroke.placeWeek(week, event)}
      >
        {Array.from({ length: COLUMNS }, (__, col) => {
          const index = bySlot.get(week * COLUMNS + col);
          return index === undefined ? (
            <View key={col} style={styles.blank} />
          ) : (
            button(days[index]!, index)
          );
        })}
      </View>
    ));
  }

  return (
    <View
      style={[styles.grid, dimmed && styles.dimmed]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      {wraps ? null : (
        <View style={[styles.week, { gap }]} aria-hidden>
          {weekdays.map((weekday) => (
            <Label key={weekday} style={styles.heading}>
              {weekday}
            </Label>
          ))}
        </View>
      )}
      <View
        ref={stroke?.ref}
        role="group"
        aria-label={label}
        style={[styles.days, stroke !== undefined && styles.paintable]}
        {...(stroke?.handlers ?? {})}
      >
        {body}
      </View>
    </View>
  );
}

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
function useStroke(paint: GridPaint | undefined) {
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
  const live = useRef(paint);
  useEffect(() => {
    live.current = paint;
  }, [paint]);

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
      return dayAt({ x: x - from.x, y: y - from.y }, boxes.current);
    };
    const reach = (x: number, y: number) => {
      const index = at(x, y);
      if (index === undefined || index === last.current) return;
      if (last.current === undefined) live.current?.begin(index);
      else live.current?.extend(index);
      last.current = index;
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
      onPanResponderRelease: () => {
        if (last.current !== undefined) live.current?.end();
        last.current = undefined;
        pending.current = undefined;
      },
      onPanResponderTerminate: () => {
        if (last.current !== undefined) live.current?.end();
        last.current = undefined;
        pending.current = undefined;
      },
    });
  }, []);
  /* eslint-enable react-hooks/refs */

  if (paint === undefined) return undefined;
  return {
    ref,
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

function DayButton({
  day,
  wraps,
  counted,
  dimmed,
  onPress,
  onLayout,
}: {
  day: GridDay;
  wraps: boolean;
  counted: boolean;
  dimmed: boolean;
  onPress: (() => void) | undefined;
  onLayout?: ((event: LayoutChangeEvent) => void) | undefined;
}) {
  const palette = usePalette();
  const ink = day.selected ? palette.onAccent : day.hasTimes ? color.accentDark : palette.ink;
  // A toggle button: `aria-pressed` on the web, where react-native-web passes
  // it through; `selected` on native, which has no pressed state to announce.
  const state: Record<string, unknown> =
    Platform.OS === 'web' ? { 'aria-pressed': day.selected } : { 'aria-selected': day.selected };

  return (
    <Pressable
      onLayout={onLayout}
      role="button"
      aria-label={day.label}
      aria-disabled={dimmed || day.disabled === true}
      disabled={dimmed || day.disabled === true || onPress === undefined}
      onPress={onPress}
      {...state}
      style={[
        styles.day,
        counted && styles.dayCounted,
        wraps && styles.dayWrapped,
        { backgroundColor: palette.surface, borderColor: palette.lineStrong },
        day.hasTimes && { backgroundColor: color.accentSoft, borderColor: color.accentSoft },
        day.selected && { backgroundColor: palette.accent, borderColor: palette.accent },
        day.disabled === true && styles.dimmed,
      ]}
    >
      {day.selected ? (
        <View style={styles.tick}>
          <Icon name="check" size={10} color={palette.onAccent} />
        </View>
      ) : null}
      {day.others === undefined ? null : (
        <View style={styles.others} aria-hidden>
          <Icon name="people" size={11} color={ink} />
          <Text style={[styles.othersText, { color: ink }]}>{day.others}</Text>
        </View>
      )}
      <Text style={[styles.number, { color: ink }]}>{wraps ? day.name : day.number}</Text>
      <Text style={[styles.tag, { color: ink }]}>{day.tag ?? ' '}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: { gap: 6 },
  days: { gap: GAP },
  week: { flexDirection: 'row', gap: GAP },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  heading: { flex: 1, textAlign: 'center' },
  blank: { flex: 1 },
  // The browser keeps the vertical scroll; a sideways start is a stroke.
  paintable: { touchAction: 'pan-y', userSelect: 'none' } as object,
  day: {
    flex: 1,
    minHeight: 60,
    minWidth: hit,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    paddingVertical: 4,
    borderRadius: radius.chip,
    borderWidth: 1,
  },
  // 66 rather than 60, so the figure in the corner clears the date.
  dayCounted: { minHeight: 66, paddingTop: 15, paddingBottom: 3 },
  dayWrapped: {
    flexGrow: 1,
    flexBasis: 96,
    paddingHorizontal: 8,
  },
  tick: { position: 'absolute', top: 2, right: 3 },
  others: {
    position: 'absolute',
    top: 4,
    left: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  othersText: {
    fontFamily: faceFor('Figtree', 600),
    fontSize: 11,
    lineHeight: 12,
    fontVariant: ['tabular-nums'],
  },
  number: {
    fontFamily: faceFor('Newsreader', 400),
    fontSize: 21,
    fontVariant: ['tabular-nums'],
  },
  tag: {
    fontFamily: faceFor('Figtree', 600),
    fontSize: 11,
  },
  dimmed: { opacity: 0.45 },
});
