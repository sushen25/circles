import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { layout, radius, space } from '@circles/tokens';

import { usePalette } from './theme';
import { useReducedMotion } from './wait';

/**
 * A bottom sheet: ground, a hairline along the top and a 22 radius on the top
 * corners only. Tapping the scrim dismisses, and so does the hardware back
 * button on Android (`onRequestClose`).
 *
 * A `Modal` sits outside `Screen`, so it pads for the safe area itself: the
 * bottom inset is added to the sheet's own padding, which keeps the last
 * control clear of the home indicator and the browser's toolbar (SUS-235).
 * `Screen` pads the screen behind, so nothing is padded twice.
 *
 * **`drawer`** gives it the first run's own motion (SUS-247, manifesto §5.5): it
 * rises over 200 ms on the drawer curve, `cubic-bezier(0.32, 0.72, 0, 1)`, and
 * leaves faster, in 160 ms, with the scrim fading alongside. Under reduced
 * motion it fades and does not move. Without it the sheet is the platform's own
 * slide, as every other sheet in the product is.
 */
type Props = {
  visible: boolean;
  onDismiss: () => void;
  label: string;
  /** What the scrim announces. Required: the component cannot know the words. */
  dismissLabel: string;
  children: ReactNode;
  drawer?: boolean | undefined;
};

const DRAWER_CURVE = [0.32, 0.72, 0, 1] as const;

/**
 * 0 is away and 1 is up. `mounted` stays true through the leaving animation, so
 * the sheet is still there to be seen going.
 */
function useDrawer(visible: boolean, on: boolean) {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const [progress] = useState(() => new Animated.Value(visible ? 1 : 0));
  const first = useRef(true);
  // Mounted the moment it is asked for, adjusted while rendering, so no frame is drawn without it.
  if (on && visible && !mounted) setMounted(true);

  useEffect(() => {
    if (!on) return undefined;
    if (first.current) {
      first.current = false;
      if (!visible) return undefined;
    }
    const moving = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: visible ? 200 : 160,
      easing: Easing.bezier(...DRAWER_CURVE),
      useNativeDriver: Platform.OS !== 'web',
    });
    moving.start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
    return () => moving.stop();
  }, [visible, on, progress]);

  return { mounted: on ? mounted : visible, progress, reduced };
}

export function Sheet({
  visible,
  onDismiss,
  label,
  dismissLabel,
  children,
  drawer = false,
}: Props) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const moving = useDrawer(visible, drawer);

  return (
    <Modal
      visible={moving.mounted}
      transparent
      animationType={drawer ? 'none' : 'slide'}
      onRequestClose={onDismiss}
      // react-native-web makes the modal's own element the dialog, and passes
      // what it does not use to it: the name belongs there, not on the sheet
      // inside it, which is not a dialog (axe: aria-dialog-name).
      {...({ 'aria-label': label } as object)}
    >
      <View style={[styles.window, { paddingLeft: insets.left, paddingRight: insets.right }]}>
        {/* Behind the sheet and across the whole window, so the sides of a narrowed sheet are dimmed and dismiss too. */}
        <Animated.View
          style={[styles.scrimFill, drawer && { opacity: moving.progress }]}
          pointerEvents="box-none"
        >
          <Pressable
            style={styles.scrim}
            role="button"
            aria-label={dismissLabel}
            onPress={onDismiss}
          />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              backgroundColor: palette.ground,
              borderTopColor: palette.line,
              paddingBottom: SHEET_BOTTOM + insets.bottom,
            },
            drawer && {
              opacity: moving.reduced ? moving.progress : 1,
              transform: [
                {
                  translateY: moving.reduced
                    ? 0
                    : moving.progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [height, 0],
                      }),
                },
              ],
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: palette.line }]} />
          {/* Bounded and scrolling: on a short viewport (a phone on its side) the
              controls at the bottom stay reachable. */}
          <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>
        </Animated.View>
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
  scrimFill: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
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
