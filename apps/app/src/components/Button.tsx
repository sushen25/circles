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
import { WAIT, useBusyGuard, useDelayedShow, useSlow } from './wait';
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

/** The spinner's edge on each control; also the room an icon-less one keeps free for it. */
const SPINNER = { button: 18, tertiary: 14, compact: 16 } as const;

/** What every busy control shares: the spinner's clock, the slow line's, the tap guard. */
function useBusy(busy: boolean | undefined, onPress: PressableProps['onPress']) {
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
function Words({
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
        <Words
          label={said}
          other={view.working ? label : busyLabel}
          style={[styles.label, { color: ink }]}
          lead={view.spinner ? <Spinner color={ink} /> : null}
          reserve={busy === undefined ? 0 : SPINNER.button + 10}
        />
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
        <Words
          label={said}
          other={view.working ? label : busyLabel}
          style={[styles.tertiaryLabel, { color: palette.ink3 }]}
          lead={view.spinner ? <Spinner size={SPINNER.tertiary} color={palette.ink3} /> : null}
          reserve={busy === undefined ? 0 : SPINNER.tertiary + 10}
        />
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
        <Words
          label={said}
          other={view.working ? label : busyLabel}
          style={[styles.compactLabel, { color: ink }, accent && styles.compactAccent]}
          gap={6}
          reserve={busy === undefined || icon !== undefined ? 0 : SPINNER.compact + 6}
          lead={
            view.spinner ? (
              <Spinner size={SPINNER.compact} color={ink} />
            ) : icon === undefined ? null : (
              <Icon name={icon} size={16} color={ink} />
            )
          }
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
export function ButtonRow({
  children,
  center = false,
}: {
  children: React.ReactNode;
  /** Sit in the middle of the line, as a footer's second row does (SUS-161). */
  center?: boolean;
}) {
  return <View style={center ? [styles.row, styles.centred] : styles.row}>{children}</View>;
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
    // Never wider than the line it sits on: at 200% type a long label wraps
    // inside its button rather than running off the screen (SUS-161).
    maxWidth: '100%',
    gap: 6,
    minHeight: hit,
    paddingHorizontal: 14,
    borderRadius: radius.chip,
    borderWidth: 1,
  },
  compactLabel: {
    fontFamily: faceFor('Figtree', 500),
    fontSize: 14,
    flexShrink: 1,
    textAlign: 'center',
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
  centred: {
    justifyContent: 'center',
  },
});
