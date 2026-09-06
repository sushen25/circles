import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { brand } from '@circles/config';
import { color, faceFor, space, type } from '@circles/tokens';

/**
 * Placeholder. The real welcome screen — and every other route in the canvas —
 * lands in S0-08 as a fixture screen, then gets its backend in Slice 1.
 *
 * It renders one line in each face so that a broken font registration is
 * visible at a glance on every platform: the display line falls back to a serif
 * and the interface lines to the system sans if the bundled faces are missing.
 */
export default function Index() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <Text style={styles.label}>Slice 0</Text>
      <Text accessibilityRole="header" style={styles.title}>
        {brand.name}
      </Text>
      <Text style={styles.body}>The app scaffold runs. Screens land in S0-08.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.related,
    padding: space.gutter,
    backgroundColor: color.ground,
  },
  label: {
    fontFamily: faceFor(type.label.fontFamily, type.label.fontWeight),
    fontSize: type.label.fontSize,
    lineHeight: type.label.lineHeight,
    letterSpacing: type.label.letterSpacing,
    textTransform: type.label.textTransform,
    color: color.ink3,
  },
  title: {
    fontFamily: faceFor(type.displayXL.fontFamily, type.displayXL.fontWeight),
    fontSize: type.displayXL.fontSize,
    lineHeight: type.displayXL.lineHeight,
    letterSpacing: type.displayXL.letterSpacing,
    color: color.ink,
  },
  body: {
    fontFamily: faceFor(type.body.fontFamily, type.body.fontWeight),
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    color: color.ink2,
    textAlign: 'center',
  },
});
