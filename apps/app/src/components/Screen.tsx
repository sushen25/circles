import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { hit, layout, size, space } from '@circles/tokens';

import { BrandMark } from './Brand';
import { Icon } from './Icon';
import { ProgressLine } from './ProgressLine';
import { Small, Title } from './Text';
import { InvertProvider, usePalette } from './theme';

/**
 * The frame every screen shares: ground, safe area, an optional top bar, a
 * scrolling body and a footer that holds the decision.
 *
 * `invert` is for the confirmed screen and nothing else (manifesto §5.1).
 *
 * On a window wider than `layout.column` the top bar, the body and the footer
 * each sit in a centred column of that width (manifesto §5.3), while the
 * ground fills the window and the body scrolls from anywhere on it. Each part
 * draws its own column, so the three share the same bounds without the footer
 * having to know about the body.
 */
type ScreenProps = {
  children: ReactNode;
  invert?: boolean;
};

export function Screen({ children, invert = false }: ScreenProps) {
  return (
    <InvertProvider value={invert}>
      <ScreenSurface>{children}</ScreenSurface>
    </InvertProvider>
  );
}

function ScreenSurface({ children }: { children: ReactNode }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.screen,
        {
          backgroundColor: palette.ground,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          // Non-zero only in landscape on a notched phone (SUS-235).
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      {children}
    </View>
  );
}

type TopBarProps = {
  title?: string | undefined;
  /**
   * `| undefined` explicitly: `exactOptionalPropertyTypes` is on, and a screen
   * that passes `onBack={props.onBack}` is passing a value that may be
   * undefined rather than omitting the prop.
   */
  onBack?: (() => void) | undefined;
  backLabel?: string | undefined;
  right?: ReactNode;
  /**
   * In place of the back action, on a screen that is the front of something
   * and has nowhere to go back to: the first run's wordmark (ADR 0053).
   */
  left?: ReactNode;
  /** The small mark in the middle, on the screens that are home (the circles list). */
  mark?: boolean | undefined;
  /**
   * Where the person is in a run of steps: "1 of 3" beside the title, and a 2 px
   * line under the bar that grows to `at / total` (SUS-247). The words are the
   * caller's, since a component holds none.
   */
  step?: { at: number; total: number; label: string; spoken: string } | undefined;
};

export function TopBar({
  title,
  onBack,
  backLabel = 'Go back',
  right,
  left,
  mark,
  step,
}: TopBarProps) {
  const palette = usePalette();
  // The count sits in the middle when there is nothing else there (the first
  // screen's wordmark has a Sign in on its right), and at the right otherwise.
  const counted =
    step === undefined ? null : (
      <Small aria-label={step.spoken} accessibilityLiveRegion="polite">
        {step.label}
      </Small>
    );
  const middle = title ? (
    <Title style={{ color: palette.ink2 }}>{title}</Title>
  ) : right !== undefined ? (
    counted
  ) : null;

  return (
    <View style={styles.topRow}>
      <View style={styles.top}>
        {left !== undefined ? (
          <View style={styles.topLeft}>{left}</View>
        ) : onBack ? (
          <Pressable role="button" aria-label={backLabel} onPress={onBack} style={styles.topAction}>
            <Icon name="back" color={palette.ink} />
          </Pressable>
        ) : (
          <View style={styles.topAction} />
        )}
        {middle}
        {!title && mark ? <BrandMark size={24} /> : null}
        <View style={[styles.topAction, styles.topRight]}>{right ?? counted}</View>
      </View>
      {step === undefined ? null : <ProgressLine fraction={step.at / step.total} />}
    </View>
  );
}

/** The scrolling middle. Sections are separated by gap, never by margins. */
export function Body({ children, style, ...props }: ViewProps & { children: ReactNode }) {
  return (
    <ScrollView
      style={styles.bodyScroll}
      contentContainerStyle={styles.bodyOuter}
      keyboardShouldPersistTaps="handled"
      {...props}
    >
      <View style={[styles.column, styles.body, style]}>{children}</View>
    </ScrollView>
  );
}

/** Where the decision lives. One primary action, at most. */
export function Foot({ children, style, ...props }: ViewProps & { children: ReactNode }) {
  return (
    <View style={styles.footRow}>
      <View style={[styles.column, styles.foot, style]} {...props}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  /** The width every part shares: the column, centred, never wider than the window. */
  column: {
    width: '100%',
    maxWidth: layout.column,
  },
  topRow: {
    alignItems: 'stretch',
  },
  top: {
    width: '100%',
    maxWidth: layout.column,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: size.topBar,
    paddingLeft: 12,
    paddingRight: 16,
  },
  topAction: {
    width: hit,
    height: hit,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topLeft: {
    height: hit,
    justifyContent: 'center',
  },
  topRight: {
    alignItems: 'flex-end',
    // As wide as what is in it, never less than a target: a fixed 44 made
    // "Sign in" wrap to two lines at 375 (SUS-204).
    width: 'auto',
    minWidth: hit,
    flexShrink: 0,
  },
  bodyScroll: {
    flex: 1,
  },
  bodyOuter: {
    flexGrow: 1,
    alignItems: 'center',
  },
  body: {
    flexGrow: 1,
    gap: space.section,
    paddingTop: 8,
    paddingHorizontal: space.gutter,
    paddingBottom: 24,
  },
  footRow: {
    alignItems: 'center',
  },
  foot: {
    gap: 10,
    paddingTop: 12,
    paddingHorizontal: space.gutter,
    paddingBottom: 28,
  },
});
