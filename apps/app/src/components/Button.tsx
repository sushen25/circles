import { Pressable, StyleSheet, Text, View, type PressableProps } from 'react-native';

import { color, faceFor, hit, radius, shadow, size, type as ramp } from '@circles/tokens';

import { useInverted, usePalette } from './theme';

/**
 * Primary names the outcome, not the mechanism; one per screen. Secondary is
 * the same height in surface with a hairline. Tertiary is underlined text —
 * everything destructive or reversible lives there, quiet but never hidden
 * (manifesto §5.4).
 */
type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  variant?: 'primary' | 'secondary';
};

export function Button({ label, variant = 'primary', disabled, ...props }: ButtonProps) {
  const palette = usePalette();
  const inverted = useInverted();
  const primary = variant === 'primary';

  return (
    <Pressable
      role="button"
      aria-label={label}
      aria-disabled={Boolean(disabled)}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        primary
          ? { backgroundColor: palette.accent, boxShadow: inverted ? undefined : shadow.elevated }
          : {
              backgroundColor: inverted ? 'transparent' : palette.surface,
              borderWidth: 1,
              borderColor: palette.lineStrong,
            },
        pressed && !primary && { backgroundColor: palette.line },
        pressed && primary && !inverted && { backgroundColor: color.accentDark },
        disabled && styles.disabled,
      ]}
      {...props}
    >
      <Text
        style={[
          styles.label,
          { color: primary ? palette.onAccent : inverted ? palette.ink : palette.ink2 },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

type TertiaryProps = Omit<PressableProps, 'children' | 'style'> & { label: string };

export function Tertiary({ label, ...props }: TertiaryProps) {
  const palette = usePalette();

  return (
    <Pressable role="button" aria-label={label} style={styles.tertiary} {...props}>
      <Text style={[styles.tertiaryLabel, { color: palette.ink3 }]}>{label}</Text>
    </Pressable>
  );
}

/** A row of buttons that share the width evenly. */
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
});
