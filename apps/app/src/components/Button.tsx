import { Fragment } from 'react';
import { Pressable, StyleSheet, View, type PressableProps } from 'react-native';

import { color, faceFor, hit, radius, shadow, size } from '@circles/tokens';

import { SPINNER, Slow, Words, shared, useBusy, type BusyProps } from './busyParts';
import { Spinner } from './Spinner';
import { useInverted, usePalette } from './theme';

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
  const primary = variant === 'primary';
  const view = useBusy(busy, onPress);
  const said = view.working ? (busyLabel ?? label) : label;
  const ink = primary ? palette.onAccent : inverted ? palette.ink : palette.ink2;
  const faded = (disabled === true || waiting) && !view.working;
  // Only a button that is waiting needs the cover over it, and so a frame for it.
  const Wrap = waiting ? View : Fragment;

  return (
    <Slow slow={view.slow}>
      <Wrap>
        <Pressable
          role="button"
          aria-label={said}
          aria-busy={view.working}
          aria-disabled={faded}
          disabled={faded}
          onPress={view.onPress}
          style={({ pressed }) => [
            styles.button,
            primary
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
  disabled: shared.disabled,
});
