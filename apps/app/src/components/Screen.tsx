import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { hit, size, space } from '@circles/tokens';

import { BrandMark } from './Brand';
import { Icon } from './Icon';
import { Title } from './Text';
import { InvertProvider, usePalette } from './theme';

/**
 * The frame every screen shares: ground, safe area, an optional top bar, a
 * scrolling body and a footer that holds the decision.
 *
 * `invert` is for the confirmed screen and nothing else (manifesto §5.1).
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
        { backgroundColor: palette.ground, paddingTop: insets.top, paddingBottom: insets.bottom },
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
};

export function TopBar({ title, onBack, backLabel = 'Go back', right, left, mark }: TopBarProps) {
  const palette = usePalette();

  return (
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
      {title ? <Title style={{ color: palette.ink2 }}>{title}</Title> : null}
      {!title && mark ? <BrandMark size={24} /> : null}
      <View style={[styles.topAction, styles.topRight]}>{right}</View>
    </View>
  );
}

/** The scrolling middle. Sections are separated by gap, never by margins. */
export function Body({ children, style, ...props }: ViewProps & { children: ReactNode }) {
  return (
    <ScrollView
      style={styles.bodyScroll}
      contentContainerStyle={[styles.body, style]}
      keyboardShouldPersistTaps="handled"
      {...props}
    >
      {children}
    </ScrollView>
  );
}

/** Where the decision lives. One primary action, at most. */
export function Foot({ children, style, ...props }: ViewProps & { children: ReactNode }) {
  return (
    <View style={[styles.foot, style]} {...props}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  top: {
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
  },
  bodyScroll: {
    flex: 1,
  },
  body: {
    gap: space.section,
    paddingTop: 8,
    paddingHorizontal: space.gutter,
    paddingBottom: 24,
    flexGrow: 1,
  },
  foot: {
    gap: 10,
    paddingTop: 12,
    paddingHorizontal: space.gutter,
    paddingBottom: 28,
  },
});
