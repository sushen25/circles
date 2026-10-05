import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import { color, faceFor, hit, radius, shadow, size, type as ramp } from '@circles/tokens';

import { Icon, type IconName } from './Icon';
import { Spinner } from './Spinner';
import { Small } from './Text';
import { useInverted, usePalette } from './theme';
import { useDelayedShow, useSlow } from './wait';
import { t } from '../copy';

/**
 * Primary names the outcome, not the mechanism; one per screen. Secondary is
 * the same height in surface with a hairline. Tertiary is underlined text —
 * everything destructive or reversible lives there, quiet but never hidden
 * (manifesto §5.4).
 */
type ButtonProps = Omit<PressableProps, 'children' | 'style'> &
  BusyProps & {
    label: string;
    variant?: 'primary' | 'secondary';
  };

/**
 * A button that is working looks like it is working: it keeps its colour and
 * its width, says the "-ing" word, and grows a spinner after ~150 ms so an
 * instant save never flickers. It ignores taps and says `aria-busy`. `disabled`
 * is left to mean one thing, "you can't do this yet", and keeps the faded look
 * (SUS-155, which also turns "Still working on it…" on at ~8 s).
 */
type BusyProps = {
  busy?: boolean | undefined;
  /** What the button says while busy: "Locking it in". */
  busyLabel?: string | undefined;
};

/** What every busy control shares: the spinner's clock, the slow line's, the tap guard. */
function useBusy(busy: boolean | undefined, onPress: PressableProps['onPress']) {
  const working = busy === true;
  const spinner = useDelayedShow(working);
  const { slow } = useSlow(working);
  return { working, spinner, slow, onPress: working ? undefined : onPress };
}

/**
 * Holds the button as wide as the longer of its two labels, so the tap that
 * swaps "Lock it in" for "Locking it in" moves nothing.
 */
function Words({
  label,
  other,
  style,
}: {
  label: string;
  other: string | undefined;
  style: StyleProp<TextStyle>;
}) {
  const longer = other !== undefined && other.length > label.length ? other : undefined;
  return (
    <View>
      <Text style={style}>{label}</Text>
      {longer === undefined ? null : (
        <Text aria-hidden style={[style, styles.sizer]}>
          {longer}
        </Text>
      )}
    </View>
  );
}

/** "Still working on it…" under a control that has been busy for ~8 s. */
function Slow({ children, slow }: { children: ReactNode; slow: boolean }) {
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

export function Button({
  label,
  busyLabel,
  busy,
  variant = 'primary',
  disabled,
  onPress,
  ...props
}: ButtonProps) {
  const palette = usePalette();
  const inverted = useInverted();
  const primary = variant === 'primary';
  const view = useBusy(busy, onPress);
  const said = view.working ? (busyLabel ?? label) : label;
  const ink = primary ? palette.onAccent : inverted ? palette.ink : palette.ink2;
  const faded = disabled === true && !view.working;

  return (
    <Slow slow={view.slow}>
      <Pressable
        role="button"
        aria-label={said}
        aria-busy={view.working}
        aria-disabled={Boolean(disabled) && !view.working}
        disabled={disabled && !view.working}
        onPress={view.onPress}
        style={({ pressed }) => [
          styles.button,
          primary
            ? { backgroundColor: palette.accent, boxShadow: inverted ? undefined : shadow.elevated }
            : {
                backgroundColor: inverted ? 'transparent' : palette.surface,
                borderWidth: 1,
                borderColor: palette.lineStrong,
              },
          pressed && !view.working && !primary && { backgroundColor: palette.line },
          pressed && !view.working && primary && !inverted && { backgroundColor: color.accentDark },
          faded && styles.disabled,
        ]}
        {...props}
      >
        <View style={styles.content}>
          {view.spinner ? <Spinner color={ink} /> : null}
          <Words
            label={said}
            other={view.working ? label : busyLabel}
            style={[styles.label, { color: ink }]}
          />
        </View>
      </Pressable>
    </Slow>
  );
}

type TertiaryProps = Omit<PressableProps, 'children' | 'style'> & BusyProps & { label: string };

export function Tertiary({ label, busyLabel, busy, onPress, ...props }: TertiaryProps) {
  const palette = usePalette();
  const view = useBusy(busy, onPress);
  const said = view.working ? (busyLabel ?? label) : label;

  return (
    <Slow slow={view.slow}>
      <Pressable
        role="button"
        aria-label={said}
        aria-busy={view.working}
        onPress={view.onPress}
        style={styles.tertiary}
        {...props}
      >
        <View style={styles.content}>
          {view.spinner ? <Spinner size={14} color={palette.ink3} /> : null}
          <Words
            label={said}
            other={view.working ? label : busyLabel}
            style={[styles.tertiaryLabel, { color: palette.ink3 }]}
          />
        </View>
      </Pressable>
    </Slow>
  );
}

type CompactProps = Omit<PressableProps, 'children' | 'style'> &
  BusyProps & {
    label: string;
    /** Beside the label, never instead of it. While busy the spinner takes its place. */
    icon?: IconName | undefined;
    /** `accent` for the action a panel is waiting on ("Done", "Undo"). */
    tone?: 'plain' | 'accent';
  };

/**
 * A bordered button sized to its label, for secondary actions inside a card or
 * a list: "Done", "Clear these days", "Remove day", "Start over", "Undo"
 * (ADR 0024). Underlined text pushed against the right edge reads as a stray
 * link on a phone; this keeps the action a visible control while staying
 * quieter than Secondary. Still a 44pt target (manifesto §6).
 */
export function CompactButton({
  label,
  busyLabel,
  busy,
  icon,
  tone = 'plain',
  disabled,
  onPress,
  ...props
}: CompactProps) {
  const palette = usePalette();
  const accent = tone === 'accent';
  const ink = accent ? color.accentDark : palette.ink2;
  const view = useBusy(busy, onPress);
  const said = view.working ? (busyLabel ?? label) : label;
  const faded = disabled === true && !view.working;

  return (
    <Slow slow={view.slow}>
      <Pressable
        role="button"
        aria-label={said}
        aria-busy={view.working}
        aria-disabled={faded}
        disabled={faded}
        onPress={view.onPress}
        style={({ pressed }) => [
          styles.compact,
          accent
            ? { backgroundColor: color.accentSoft, borderColor: color.accentSoft }
            : { backgroundColor: palette.surface, borderColor: palette.lineStrong },
          pressed && !view.working && { backgroundColor: palette.line },
          faded && styles.disabled,
        ]}
        {...props}
      >
        {view.spinner ? (
          <Spinner size={16} color={ink} />
        ) : icon === undefined ? null : (
          <Icon name={icon} size={16} color={ink} />
        )}
        <Words
          label={said}
          other={view.working ? label : busyLabel}
          style={[styles.compactLabel, { color: ink }, accent && styles.compactAccent]}
        />
      </Pressable>
    </Slow>
  );
}

/**
 * A row of buttons, side by side while they fit and wrapped onto the next line
 * when they do not: a narrow phone, a long translation, or text at 200%. A row
 * that cannot wrap pushes its last button through the card's edge (SUS-132).
 */
export function ButtonRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  button: {
    height: size.button,
    minHeight: hit,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  label: {
    fontFamily: faceFor('Figtree', 600),
    fontSize: 16,
  },
  disabled: {
    opacity: 0.5,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  sizer: {
    height: 0,
    opacity: 0,
    overflow: 'hidden',
  },
  slowWrap: {
    gap: 8,
  },
  slow: {
    textAlign: 'center',
  },
  tertiary: {
    minHeight: hit,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tertiaryLabel: {
    fontFamily: faceFor('Figtree', ramp.body.fontWeight),
    fontSize: 14,
    textDecorationLine: 'underline',
  },
  compact: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    minHeight: hit,
    paddingHorizontal: 14,
    borderRadius: radius.chip,
    borderWidth: 1,
  },
  compactLabel: {
    fontFamily: faceFor('Figtree', 500),
    fontSize: 14,
  },
  compactAccent: {
    fontFamily: faceFor('Figtree', 600),
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
  },
});
