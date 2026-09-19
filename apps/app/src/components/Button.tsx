import { Pressable, StyleSheet, Text, View, type PressableProps } from 'react-native';

import { color, faceFor, hit, radius, shadow, size, type as ramp } from '@circles/tokens';

import { Icon, type IconName } from './Icon';
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

type CompactProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  /** Beside the label, never instead of it. */
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
export function CompactButton({ label, icon, tone = 'plain', disabled, ...props }: CompactProps) {
  const palette = usePalette();
  const accent = tone === 'accent';
  const ink = accent ? color.accentDark : palette.ink2;

  return (
    <Pressable
      role="button"
      aria-label={label}
      aria-disabled={Boolean(disabled)}
      disabled={disabled}
      style={({ pressed }) => [
        styles.compact,
        accent
          ? { backgroundColor: color.accentSoft, borderColor: color.accentSoft }
          : { backgroundColor: palette.surface, borderColor: palette.lineStrong },
        pressed && { backgroundColor: palette.line },
        disabled && styles.disabled,
      ]}
      {...props}
    >
      {icon === undefined ? null : <Icon name={icon} size={16} color={ink} />}
      <Text style={[styles.compactLabel, { color: ink }, accent && styles.compactAccent]}>
        {label}
      </Text>
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
    alignItems: 'center',
    gap: 12,
  },
});
