import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { color, radius } from '@circles/tokens';

import { usePalette } from './theme';

/**
 * Surface on a hairline. The recommended option gets a 1.5px accent border,
 * never a different fill — rank is stated in words beside it, so the border is
 * emphasis rather than the message (manifesto §5.4).
 */
type Props = ViewProps & {
  children: ReactNode;
  recommended?: boolean;
  gap?: number;
  padding?: number;
  /** Shown but not in play: faded, as a track is under "I'm easy". */
  dimmed?: boolean;
};

export function Card({
  children,
  recommended = false,
  gap = 12,
  padding = 18,
  dimmed = false,
  style,
  ...props
}: Props) {
  const palette = usePalette();

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: palette.surface, borderColor: palette.line, gap, padding },
        recommended && { borderWidth: 1.5, borderColor: color.accent },
        dimmed && styles.dimmed,
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    borderWidth: 1,
    flexDirection: 'column',
  },
  dimmed: {
    opacity: 0.45,
  },
});
