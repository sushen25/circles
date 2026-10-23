import { Fragment } from 'react';
import { Pressable, StyleSheet, View, type PressableProps } from 'react-native';

import { color, faceFor, hit, radius, shadow, size } from '@circles/tokens';

import { SPINNER, Slow, Words, pressed97, shared, useBusy, type BusyProps } from './busyParts';
import { Spinner } from './Spinner';
import { useInverted, usePalette } from './theme';
import { useReducedMotion } from './wait';

/**
 * Primary names the outcome, not the mechanism; one per screen. Secondary is
 * the same height in surface with a hairline. The quiet actions, Tertiary and
 * CompactButton, live in `CompactButton.tsx` (manifesto §5.4).
 */
type ButtonProps = Omit<PressableProps, 'children' | 'style'> &
  BusyProps & {
    label: string;
    variant?: 'primary' | 'secondary';
    /**
     * Unavailable to a screen reader and to the keyboard, as a disabled button
     * is, but a tap or a click on it still reaches `onPress`: for a decision
     * that is waiting on something the screen then names when it is pressed
     * ("Pick at least one evening first"), which a plain disabled button
     * cannot say. The press is caught by a cover that assistive technology
     * never sees, so what it hears is a button that is not available yet.
     */
    waiting?: boolean | undefined;
  };

export function Button({
  label,
  busyLabel,
  busy,
  variant = 'primary',
  waiting = false,
  disabled,
  onPress,
  ...props
}: ButtonProps) {
  const palette = usePalette();
  const inverted = useInverted();
  const reduced = useReducedMotion();
  const primary = variant === 'primary';
  const view = useBusy(busy, onPress);
  const said = view.working ? (busyLabel ?? label) : label;
  // A button that is waiting answers a press with its reason, so its words stay
  // legible: accent-dark on accent-soft (5:1) rather than a faded primary
  // (SUS-250). On the inverted ground the fade is kept.
  const legible = waiting && primary && !inverted && !view.working && disabled !== true;
  const ink = legible
    ? color.accentDark
    : primary
      ? palette.onAccent
      : inverted
        ? palette.ink
        : palette.ink2;
  const faded = (disabled === true || (waiting && !legible)) && !view.working;
  // Only a button that is waiting needs the cover over it, and so a frame for it.
  const Wrap = waiting ? View : Fragment;

  return (
    <Slow slow={view.slow}>
      <Wrap>
        <Pressable
          role="button"
          aria-label={said}
          aria-busy={view.working}
          aria-disabled={faded || legible}
          disabled={faded || legible}
          onPress={view.onPress}
          style={({ pressed }) => [
            styles.button,
            legible
              ? { backgroundColor: color.accentSoft, borderWidth: 1, borderColor: color.accentSoft }
              : primary
                ? {
                    backgroundColor: palette.accent,
                    boxShadow: inverted ? undefined : shadow.elevated,
                  }
                : {
                    backgroundColor: inverted ? 'transparent' : palette.surface,
                    borderWidth: 1,
                    borderColor: palette.lineStrong,
                  },
            pressed && !view.working && !primary && { backgroundColor: palette.line },
            pressed &&
              !view.working &&
              primary &&
              !inverted && { backgroundColor: color.accentDark },
            // The light primary on the dark ground has a pressed state too (SUS-250).
            pressed && !view.working && primary && inverted && { opacity: 0.82 },
            faded && styles.disabled,
            pressed97(pressed && !view.working, reduced),
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
        {waiting && !view.working ? (
          <Pressable
            testID="waiting-press"
            aria-hidden
            focusable={false}
            tabIndex={-1}
            importantForAccessibility="no-hide-descendants"
            style={StyleSheet.absoluteFill}
            onPress={onPress}
          />
        ) : null}
      </Wrap>
    </Slow>
  );
}

export { ButtonRow, CompactButton, Tertiary } from './CompactButton';

const styles = StyleSheet.create({
  button: {
    // Grows with its words: at 200% text a long label wraps, and a fixed height cut it off (SUS-250).
    minHeight: Math.max(size.button, hit),
    paddingVertical: 8,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  label: {
    fontFamily: faceFor('Figtree', 600),
    fontSize: 16,
    textAlign: 'center',
  },
  disabled: shared.disabled,
});
