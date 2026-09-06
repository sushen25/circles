import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { brand } from '@circles/config';

/**
 * Placeholder. The real welcome screen — and every other route in the canvas —
 * lands in S0-08 as a fixture screen, then gets its backend in Slice 1.
 */
export default function Index() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
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
    gap: 8,
    padding: 24,
    backgroundColor: '#FFFFFF',
  },
  title: {
    fontSize: 32,
  },
  body: {
    fontSize: 16,
    textAlign: 'center',
  },
});
