import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { hit, size, space } from '@circles/tokens';

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
  title?: string;
  onBack?: () => void;
  backLabel?: string;
  right?: ReactNode;
};

export function TopBar({ title, onBack, backLabel = 'Go back', right }: TopBarProps) {
  const palette = usePalette();

  return (
    <View style={styles.top}>
      {onBack ? (
        <Pressable role="button" aria-label={backLabel} onPress={onBack} style={styles.topAction}>
          <Icon name="back" color={palette.ink} />
        </Pressable>
      ) : (
        <View style={styles.topAction} />
      )}
      {title ? <Title style={{ color: palette.ink2 }}>{title}</Title> : null}
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
