import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { color, space } from '@circles/tokens';

/**
 * The three arrangements the canvas uses. Layouts are flex with `gap`, never
 * margins between siblings (manifesto §6), so type can grow to 200% without
 * anything colliding.
 */
export function Row({ children, gap = space.related }: { children: ReactNode; gap?: number }) {
  return <View style={[styles.row, { gap }]}>{children}</View>;
}

/** A row whose ends are pushed apart. */
export function Between({ children }: { children: ReactNode }) {
  return <View style={styles.between}>{children}</View>;
}

export function Stack({ children, gap = 6 }: { children: ReactNode; gap?: number }) {
  return <View style={[styles.stack, { gap }]}>{children}</View>;
}

/** A hairline inside a card. */
export function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.related,
  },
  stack: { flexDirection: 'column' },
  divider: { height: 1, backgroundColor: color.lineSoft },
});
