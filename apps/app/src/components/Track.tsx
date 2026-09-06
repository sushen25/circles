import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, View } from 'react-native';

import { cell as cellToken, color, faceFor, space } from '@circles/tokens';

import { Small, Title, numeric } from './Text';
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
 */
type Props = {
  /** The day, spelled out — it goes into every cell's accessible label. */
  day: string;
  cells: readonly boolean[];
  onChange: (cells: boolean[]) => void;
  /** Minutes from midnight at the first cell. */
  startMinutes: number;
  /** Indices greyed by a local calendar overlay. Always overridable. */
  busy?: readonly number[];
  ticks?: readonly string[];
  formatTime?: TimeFormatter;
  noneLabel?: string;
};

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
}: Props) {
  const palette = usePalette();
  const format = useMemo(() => formatTime ?? defaultTimeFormatter(), [formatTime]);
  const [width, setWidth] = useState(0);

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

  const range = rangeLabel(cells, startMinutes, format, noneLabel);
  const anySelected = cells.some(Boolean);

  return (
    <View style={styles.day}>
      <View style={styles.header}>
        <Title>{day}</Title>
        <Small style={[numeric, styles.range, { color: anySelected ? palette.ink : palette.ink3 }]}>
          {range}
        </Small>
      </View>

      <View
        style={styles.track}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        {...responder.panHandlers}
      >
        {cells.map((on, index) => (
          <Pressable
            key={index}
            role="checkbox"
            aria-label={
              busy.includes(index)
                ? `${cellLabel(day, index, startMinutes, format)}. Your calendar shows something here`
                : cellLabel(day, index, startMinutes, format)
            }
            aria-checked={on}
            onPress={() => onChange(paintSpan(cells, index, index, !on))}
            style={[
              styles.cell,
              { backgroundColor: palette.surface, borderColor: palette.line },
              busy.includes(index) && {
                backgroundColor: color.lineSoft,
                borderColor: color.lineSoft,
              },
              on && { backgroundColor: palette.accent, borderColor: palette.accent },
            ]}
          />
        ))}
      </View>

      {ticks ? (
        <View style={styles.ticks}>
          {ticks.map((tick) => (
            <Small key={tick} style={[styles.tick, numeric]}>
              {tick}
            </Small>
          ))}
        </View>
      ) : null}
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
});
