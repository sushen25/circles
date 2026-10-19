import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { layout, radius, space } from '@circles/tokens';

import { usePalette } from './theme';

/**
 * A bottom sheet: ground, a hairline along the top and a 22 radius on the top
 * corners only. Tapping the scrim dismisses, and so does the hardware back
 * button on Android (`onRequestClose`).
 *
 * A `Modal` sits outside `Screen`, so it pads for the safe area itself: the
 * bottom inset is added to the sheet's own padding, which keeps the last
 * control clear of the home indicator and the browser's toolbar (SUS-235).
 * `Screen` pads the screen behind, so nothing is padded twice.
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
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
      // react-native-web makes the modal's own element the dialog, and passes
      // what it does not use to it: the name belongs there, not on the sheet
      // inside it, which is not a dialog (axe: aria-dialog-name).
      {...({ 'aria-label': label } as object)}
    >
      <View style={styles.window}>
        {/* Behind the sheet and across the whole window, so the sides of a narrowed sheet are dimmed and dismiss too. */}
        <Pressable
          style={styles.scrim}
          role="button"
          aria-label={dismissLabel}
          onPress={onDismiss}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              backgroundColor: palette.ground,
              borderTopColor: palette.line,
              paddingBottom: SHEET_BOTTOM + insets.bottom,
              paddingLeft: Math.max(space.gutter, insets.left),
              paddingRight: Math.max(space.gutter, insets.right),
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: palette.line }]} />
          {/* Bounded and scrolling: on a short viewport (a phone on its side) the
              controls at the bottom stay reachable. */}
          <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** The sheet's own padding below its last control, before the safe-area inset. */
const SHEET_BOTTOM = 28;

const styles = StyleSheet.create({
  window: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(34, 30, 25, 0.32)',
  },
  sheet: {
    // The same column as the screen behind it, anchored to the window's bottom.
    alignSelf: 'center',
    width: '100%',
    maxWidth: layout.column,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderTopWidth: 1,
    paddingTop: 8,
    paddingHorizontal: space.gutter,
    paddingBottom: SHEET_BOTTOM,
    gap: 14,
    maxHeight: '92%',
  },
  content: { gap: 14 },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radius.pill,
  },
});
