import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { radius, space } from '@circles/tokens';

import { usePalette } from './theme';

/**
 * A bottom sheet: ground, a hairline along the top and a 22 radius on the top
 * corners only. Tapping the scrim dismisses, and so does the hardware back
 * button on Android (`onRequestClose`).
 */
type Props = {
  visible: boolean;
  onDismiss: () => void;
  label: string;
  /** What the scrim announces. Required: the component cannot know the words. */
  dismissLabel: string;
  children: ReactNode;
};

export function Sheet({ visible, onDismiss, label, dismissLabel, children }: Props) {
  const palette = usePalette();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <Pressable style={styles.scrim} role="button" aria-label={dismissLabel} onPress={onDismiss} />
      <View
        accessibilityViewIsModal
        aria-modal
        aria-label={label}
        style={[styles.sheet, { backgroundColor: palette.ground, borderTopColor: palette.line }]}
      >
        <View style={[styles.handle, { backgroundColor: palette.line }]} />
        {children}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(34, 30, 25, 0.32)',
  },
  sheet: {
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderTopWidth: 1,
    paddingTop: 8,
    paddingHorizontal: space.gutter,
    paddingBottom: 28,
    gap: 14,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radius.pill,
  },
});
