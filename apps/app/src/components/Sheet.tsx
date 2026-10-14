import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { layout, radius, space } from '@circles/tokens';

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
          style={[styles.sheet, { backgroundColor: palette.ground, borderTopColor: palette.line }]}
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
    paddingBottom: 28,
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
