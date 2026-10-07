import { Pressable, StyleSheet, View, type PressableProps } from 'react-native';

import { faceFor, hit, radius } from '@circles/tokens';

import { SPINNER, Slow, Words, shared, useBusy, type BusyProps } from './busyParts';
import { Icon, type IconName } from './Icon';
import { Spinner } from './Spinner';
import { usePalette } from './theme';

type CompactProps = Omit<PressableProps, 'children' | 'style'> &
  BusyProps & {
    label: string;
    /** Beside the label, never instead of it. While busy the spinner takes its place. */
    icon?: IconName | undefined;
    /**
     * `accent` for a way forward or a correction: "Done", "Undo", "Not now".
     * `plain` for the one action that lets go of something: "Cancel this plan".
     */
    tone?: 'plain' | 'accent' | undefined;
    /** Sit in the middle of the line, as a quiet action under a primary does. */
    centered?: boolean | undefined;
  };

/**
 * A button sized to its label, for the quieter actions: "Done", "Clear these
 * days", "Start over", "Undo" (ADR 0024), and every `Tertiary` (SUS-168).
 * Underlined text reads as a web link on a phone and hides its tap target;
 * this keeps the action a visible control while staying quieter than
 * Secondary. Still a 44pt target (manifesto §6). One shape, two tones: the soft
 * accent fill for the way forward, the hairline for letting go. On the
 * inverted ground each reads its colours from the palette.
 */
export function CompactButton({
  label,
  busyLabel,
  busy,
  icon,
  tone = 'plain',
  centered = false,
  disabled,
  onPress,
  ...props
}: CompactProps) {
  const palette = usePalette();
  const accent = tone === 'accent';
  const ink = accent ? palette.softInk : palette.ink2;
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
          centered && styles.centered,
          accent
            ? { backgroundColor: palette.softFill, borderColor: palette.softFill }
            : { backgroundColor: palette.plainFill, borderColor: palette.lineStrong },
          pressed && !view.working && { backgroundColor: palette.line },
          faded && shared.disabled,
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
 * The quiet action: "Not now", "Change my answer", "Cancel this plan". It is the
 * compact button under another name, centred on its line, soft accent by
 * default and `tone="plain"` for the one that lets go (manifesto §5.4). Never
 * hidden, never underlined text. A Tertiary that shows progress uses `busy`.
 */
export function Tertiary({ tone = 'accent', ...props }: Omit<CompactProps, 'icon' | 'centered'>) {
  return <CompactButton tone={tone} centered {...props} />;
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
  centered: {
    alignSelf: 'center',
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
