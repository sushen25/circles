import { StyleSheet, View } from 'react-native';

import { cell as cellToken, faceFor, space } from '@circles/tokens';

import { Small, numeric } from './Text';
import { usePalette } from './theme';

/**
 * The lines of text that run with a `Track`'s cells: the times under them, and
 * — in the availability editor — how many others are free over each one
 * (SUS-129). Split from `Track` so that file stays about painting.
 *
 * Both take the row's geometry: on a row that fits, the cells share the width
 * and so do these; on a row that scrolls, each cell is `cellWidth` wide and
 * these are laid out to the same step, inside the same scroll view, so they
 * move with the cells.
 */
type Geometry = {
  count: number;
  /** Undefined on a row that fits the width. */
  cellWidth: number | undefined;
};

export type Mark = { at: number; label: string };

export function TrackMarks({ marks, count, cellWidth }: Geometry & { marks: readonly Mark[] }) {
  if (cellWidth === undefined) {
    return (
      <View style={styles.ticks}>
        {marks.map((mark) => (
          <Small key={`${mark.at}-${mark.label}`} style={[styles.tick, numeric]}>
            {mark.label}
          </Small>
        ))}
      </View>
    );
  }
  const step = cellWidth + cellToken.gap;
  return (
    <View style={[styles.marks, { width: count * step - cellToken.gap }]}>
      {marks.map((mark) => (
        <Small
          key={`${mark.at}-${mark.label}`}
          style={[
            styles.tick,
            numeric,
            styles.mark,
            mark.at === count ? { right: 0 } : { left: mark.at * step },
          ]}
        >
          {mark.label}
        </Small>
      ))}
    </View>
  );
}

/** One figure over a cell, and whether it is the day's highest. */
export type CellCount = { text: string; top: boolean };

/**
 * A figure over each cell. Hidden from a screen reader: every cell's own label
 * already says how many are free in it, so this would be said twice.
 */
export function TrackCounts({ counts, cellWidth }: Geometry & { counts: readonly CellCount[] }) {
  const palette = usePalette();
  return (
    <View style={styles.counts} aria-hidden>
      {counts.map((count, index) => (
        <Small
          key={index}
          style={[
            styles.count,
            numeric,
            cellWidth === undefined ? styles.shared : { width: cellWidth },
            { color: count.top ? palette.ink : palette.ink2 },
            count.top && styles.top,
          ]}
        >
          {count.text}
        </Small>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  ticks: { flexDirection: 'row', justifyContent: 'space-between' },
  tick: { fontSize: 11 },
  marks: { height: 16 },
  mark: { position: 'absolute', top: 0 },
  counts: { flexDirection: 'row', gap: cellToken.gap, marginBottom: -space.tight / 2 },
  count: { fontSize: 11, lineHeight: 14, textAlign: 'center' },
  shared: { flex: 1 },
  top: { fontFamily: faceFor('Figtree', 600) },
});
