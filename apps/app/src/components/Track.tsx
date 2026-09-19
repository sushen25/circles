import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PanResponder, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { cell as cellToken, color, faceFor, space } from '@circles/tokens';

import { Small, Title, numeric } from './Text';
import { spaceToPress } from './keys';
import { usePalette } from './theme';
import {
  type TimeFormatter,
  cellLabel,
  defaultTimeFormatter,
  paintSpan,
  rangeLabel,
} from './availability';

/**
 * A day as one row: a header line, a ten-cell half-hour grid, and the selected
 * range rendered as text beside the date.
 *
 * Painting works by drag and by tap. The parent takes the drag; the cells keep
 * their own press handlers, so the grid stays operable one cell at a time for
 * anyone using a screen reader or a keyboard — the grid must be comprehensible
 * without sight of the fill (manifesto §6).
 *
 * **A row longer than ten cells scrolls** (ADR 0009): a weekend day is
 * twenty-seven half hours, and ten stay the width of the screen. There a
 * sideways drag is the scroll, so it cannot also be the paint — a finger
 * cannot mean both — and a scrolling row paints by tap. The shortcuts and
 * "Any time that day" are what make a long day quick.
 */
type Props = {
  /** The day, spelled out — it goes into every cell's accessible label. */
  day: string;
  cells: readonly boolean[];
  onChange: (cells: boolean[]) => void;
  /** Minutes from midnight at the first cell. */
  startMinutes: number;
  /** Indices greyed by a local calendar overlay. Always overridable. */
  busy?: readonly number[] | undefined;
  ticks?: readonly string[] | undefined;
  formatTime?: TimeFormatter | undefined;
  noneLabel?: string | undefined;
  /**
   * Each cell's accessible name, when the caller knows better than
   * `startMinutes + index × 30` — which is wrong twice a year: the night the
   * clocks change, a row has two more or two fewer real half hours.
   */
  labels?: readonly string[] | undefined;
  /** The answer in words, when the caller has worked it out from real windows. */
  range?: string | undefined;
  /** Times at cell boundaries (`at` is a boundary index, 0 to `cells.length`). */
  marks?: readonly { at: number; label: string }[] | undefined;
  /** The row's name for a screen reader, when `day` is abbreviated ("Mon 14 Sep"). */
  groupLabel?: string | undefined;
  /** "I'm easy" is on: the row is kept, shown faded, and not paintable. */
  dimmed?: boolean | undefined;
  /** Under the row: "Any time that day". */
  footer?: ReactNode;
  /**
   * The date and range above the cells. Off where the row sits under a line
   * that already says both, as the availability editor's adjust row does.
   */
  header?: boolean | undefined;
};

/** How many cells fit the width before the row scrolls (ADR 0009). */
const VISIBLE = 10;

/** Which cell a horizontal offset falls in, or -1 before the row has a width. */
function indexAt(x: number, cells: readonly boolean[], width: number): number {
  if (width <= 0) return -1;
  const step = (width + cellToken.gap) / cells.length;
  return Math.max(0, Math.min(cells.length - 1, Math.floor(x / step)));
}

export function Track({
  day,
  cells,
  onChange,
  startMinutes,
  busy = [],
  ticks,
  formatTime,
  noneLabel = 'Not this day',
  labels,
  range: givenRange,
  marks,
  groupLabel,
  dimmed = false,
  footer,
  header = true,
}: Props) {
  const palette = usePalette();
  const format = useMemo(() => formatTime ?? defaultTimeFormatter(), [formatTime]);
  const [width, setWidth] = useState(0);
  const [viewport, setViewport] = useState(0);
  const scrolls = cells.length > VISIBLE;
  // Ten to the viewport, whatever the row's length, so a half hour is the same
  // width on every row of the plan.
  const cellWidth = viewport > 0 ? (viewport - (VISIBLE - 1) * cellToken.gap) / VISIBLE : 0;

  // The responder is created once, so a stroke is never interrupted by a
  // re-render mid-drag. It therefore cannot close over `cells` — that would go
  // stale on the first painted cell — so the live values are published to a ref
  // in an effect, after render, and the handlers read them from there.
  const live = useRef({ cells, width, onChange });
  useEffect(() => {
    live.current = { cells, width, onChange };
  }, [cells, width, onChange]);

  // Transient state for the stroke in progress.
  const stroke = useRef({ anchor: 0, mode: true });

  /* eslint-disable react-hooks/refs -- PanResponder does not invoke these
     during render; it stores them and calls them from touch events, which is
     the whole point of building the responder once. */
  const responder = useMemo(
    () =>
      PanResponder.create({
        // A tap belongs to the cell under it; only a drag is ours.
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 4,
        onPanResponderGrant: (event) => {
          const { cells: current, width: row, onChange: emit } = live.current;
          const index = indexAt(event.nativeEvent.locationX, current, row);
          if (index < 0) return;
          const mode = !current[index];
          stroke.current = { anchor: index, mode };
          emit(paintSpan(current, index, index, mode));
        },
        onPanResponderMove: (event) => {
          const { cells: current, width: row, onChange: emit } = live.current;
          const index = indexAt(event.nativeEvent.locationX, current, row);
          if (index < 0) return;
          const { anchor, mode } = stroke.current;
          emit(paintSpan(current, anchor, index, mode));
        },
      }),
    [],
  );
  /* eslint-enable react-hooks/refs */

  const range = givenRange ?? rangeLabel(cells, startMinutes, format, noneLabel);
  const anySelected = cells.some(Boolean);
  const labelFor = (index: number) =>
    labels?.[index] ?? cellLabel(day, index, startMinutes, format);

  const grid = cells.map((on, index) => (
    <Pressable
      key={index}
      role="checkbox"
      aria-label={
        busy.includes(index)
          ? `${labelFor(index)}. Your calendar shows something here`
          : labelFor(index)
      }
      aria-checked={on}
      aria-disabled={dimmed}
      disabled={dimmed}
      onPress={() => onChange(paintSpan(cells, index, index, !on))}
      {...(dimmed ? {} : spaceToPress(() => onChange(paintSpan(cells, index, index, !on))))}
      style={[
        styles.cell,
        scrolls ? { width: cellWidth, flex: 0 } : null,
        { backgroundColor: palette.surface, borderColor: palette.line },
        busy.includes(index) && {
          backgroundColor: color.lineSoft,
          borderColor: color.lineSoft,
        },
        on && { backgroundColor: palette.accent, borderColor: palette.accent },
      ]}
    />
  ));

  const step = cellWidth + cellToken.gap;
  const markRow =
    marks === undefined ? null : scrolls ? (
      <View style={[styles.marks, { width: cells.length * step - cellToken.gap }]}>
        {marks.map((mark) => (
          <Small
            key={`${mark.at}-${mark.label}`}
            style={[
              styles.tick,
              numeric,
              styles.mark,
              mark.at === cells.length ? { right: 0 } : { left: mark.at * step },
            ]}
          >
            {mark.label}
          </Small>
        ))}
      </View>
    ) : (
      <View style={styles.ticks}>
        {marks.map((mark) => (
          <Small key={`${mark.at}-${mark.label}`} style={[styles.tick, numeric]}>
            {mark.label}
          </Small>
        ))}
      </View>
    );

  return (
    <View style={[styles.day, dimmed && styles.dimmed]}>
      {header ? (
        <View style={styles.header}>
          <Title>{day}</Title>
          <Small
            style={[numeric, styles.range, { color: anySelected ? palette.ink : palette.ink3 }]}
          >
            {range}
          </Small>
        </View>
      ) : null}

      {scrolls ? (
        <View onLayout={(event) => setViewport(event.nativeEvent.layout.width)}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.scrolled}>
              <View role="group" aria-label={groupLabel ?? day} style={styles.track}>
                {grid}
              </View>
              {markRow}
            </View>
          </ScrollView>
        </View>
      ) : (
        <>
          <View
            role="group"
            aria-label={groupLabel ?? day}
            style={styles.track}
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
            {...(dimmed ? {} : responder.panHandlers)}
          >
            {grid}
          </View>
          {markRow}
        </>
      )}

      {marks === undefined && ticks ? (
        <View style={styles.ticks}>
          {ticks.map((tick) => (
            <Small key={tick} style={[styles.tick, numeric]}>
              {tick}
            </Small>
          ))}
        </View>
      ) : null}
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  day: {
    gap: space.tight,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  range: {
    fontFamily: faceFor('Figtree', 500),
    fontSize: 14,
  },
  track: {
    flexDirection: 'row',
    gap: cellToken.gap,
  },
  cell: {
    flex: 1,
    height: cellToken.height,
    borderRadius: 6,
    borderWidth: 1,
  },
  ticks: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tick: {
    fontSize: 11,
  },
  dimmed: {
    opacity: 0.45,
  },
  scrolled: {
    gap: space.tight,
  },
  marks: {
    height: 16,
  },
  mark: {
    position: 'absolute',
    top: 0,
  },
});
