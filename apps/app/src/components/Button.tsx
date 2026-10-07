import { Pressable, StyleSheet, type PressableProps } from 'react-native';

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
  };

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
