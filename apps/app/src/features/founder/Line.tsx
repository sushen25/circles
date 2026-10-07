import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { space } from '@circles/tokens';

import { Small } from '../../components';

/**
 * A label and a figure on one line: the label gives way and wraps, the figure
 * does not, so a long label at 200% type never pushes a number off the screen.
 */
export function Line({ label, figure }: { label: ReactNode; figure: string }) {
  return (
    <View style={styles.line}>
      <View style={styles.label}>{typeof label === 'string' ? <Small>{label}</Small> : label}</View>
      <Small style={styles.figure}>{figure}</Small>
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.related,
  },
  label: { flex: 1, flexShrink: 1 },
  figure: { flexShrink: 0, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
