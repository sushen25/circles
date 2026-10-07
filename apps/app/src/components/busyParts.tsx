import type { ReactNode } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import { Small } from './Text';
import { WAIT, useBusyGuard, useDelayedShow, useSlow } from './wait';
import { t } from '../copy';

/**
 * A button that is working looks like it is working: it keeps its colour and
 * its width, says the "-ing" word, and grows a spinner after ~150 ms so an
 * instant save never flickers. It ignores taps and says `aria-busy`. `disabled`
 * is left to mean one thing, "you can't do this yet", and keeps the faded look
 * (SUS-155, which also turns "Still working on it…" on at ~8 s).
 */
export type BusyProps = {
  busy?: boolean | undefined;
  /** What the button says while busy: "Locking it in". */
  busyLabel?: string | undefined;
};

/** The spinner's edge on each control; also the room an icon-less one keeps free for it. */
export const SPINNER = { button: 18, tertiary: 14, compact: 16 } as const;

/** What every busy control shares: the spinner's clock, the slow line's, the tap guard. */
export function useBusy(busy: boolean | undefined, onPress: PressableProps['onPress']) {
  const working = busy === true;
  // A button's spinner goes with its "-ing" label, so there is no minimum to keep.
  const spinner = useDelayedShow(working, WAIT.spinnerAfter, 0);
  const { slow } = useSlow(working);
  const press = useBusyGuard(working, onPress);
  return { working, spinner, slow, onPress: press };
}

/**
 * Holds the button as wide as the longer of its two labels, so the tap that
 * swaps "Lock it in" for "Locking it in" moves nothing. `reserve` is the room
 * for a spinner that has no icon to take the place of: a control that can turn
 * busy keeps it free from the start, so the spinner arriving moves nothing
 * either (SUS-157). The width is the same idle and busy; only what is drawn in
 * it changes.
 */
export function Words({
  label,
  other,
  style,
  lead,
  gap = 10,
  reserve = 0,
}: {
  label: string;
  other: string | undefined;
  style: StyleProp<TextStyle>;
  /** The spinner, or a compact button's icon, before the words. */
  lead?: ReactNode;
  gap?: number;
  /** The spinner's width, to keep free when nothing else sits where it will go. */
  reserve?: number;
}) {
  const row = [styles.content, { gap }];
  const longer = other !== undefined && other.length > label.length ? other : label;
  if (longer === label && reserve === 0) {
    return (
      <View style={row}>
        {lead}
        <Text style={style}>{label}</Text>
      </View>
    );
  }
  // The longest words hold the width, unseen, with the spinner's room before
  // them; what is being said sits over it, with the spinner beside it.
  return (
    <View>
      <View style={[styles.content, { gap }]}>
        {reserve > 0 ? <View testID="spinner-room" style={{ width: reserve }} /> : null}
        <Text aria-hidden style={[style, styles.sizer]}>
          {longer}
        </Text>
      </View>
      <View style={[row, styles.overlay]}>
        {lead}
        <Text style={style}>{label}</Text>
      </View>
    </View>
  );
}

/** "Still working on it…" under a control that has been busy for ~8 s. */
export function Slow({ children, slow }: { children: ReactNode; slow: boolean }) {
  if (!slow) return <>{children}</>;
  return (
    <View style={styles.slowWrap}>
      {children}
      <Small accessibilityLiveRegion="polite" style={styles.slow}>
        {t('common', 'still_working')}
      </Small>
    </View>
  );
}

/** What every button's busy and faded states share. */
export const shared = StyleSheet.create({
  disabled: {
    opacity: 0.5,
  },
});

const styles = StyleSheet.create({
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    flexShrink: 1,
  },
  sizer: {
    opacity: 0,
  },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  slowWrap: {
    gap: 8,
  },
  slow: {
    textAlign: 'center',
  },
});
