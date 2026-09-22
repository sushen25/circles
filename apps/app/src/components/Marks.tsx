import { StyleSheet, Text, View } from 'react-native';

import { color, faceFor, markOverlap, radius, size } from '@circles/tokens';

import { usePalette } from './theme';

/**
 * Rounded squares with an initial, overlapped. A member who has not answered
 * gets a dashed outline — never a greyed-out or crossed-through person
 * (manifesto §5.4).
 *
 * The group carries one accessible label naming everyone and their state, so a
 * screen reader hears the same thing the fill shows, rather than a run of
 * single letters.
 */
export type Member = {
  name: string;
  /** True when they have not answered yet. */
  waiting?: boolean;
};

type Props = {
  members: readonly Member[];
  large?: boolean;
  /**
   * Most marks to draw before the rest become a "+N" tile.
   *
   * A circle holds twenty (ADR 0012), and twenty overlapped squares is a smear
   * rather than a group. The screens that can see a whole circle pass a cap;
   * with none, nothing is capped, which is what every screen drawn for a circle
   * of six already expects. The accessible label always names everybody, so
   * the tile hides a mark and never a person.
   */
  max?: number | undefined;
  /**
   * What a screen reader hears instead of who has answered.
   *
   * The default describes reply state, which is right on a plan and wrong
   * anywhere the marks mean only "who is in": the Join page and Continue-as
   * carry names and no reply state at all (ADR 0006), and "M answered" there
   * announces something the data does not say.
   */
  label?: string | undefined;
};

export function Marks({ members, large = false, max, label: given }: Props) {
  const palette = usePalette();
  const dimension = large ? size.markLarge : size.mark;

  // One place is kept for the count, so the cap is the width of the row and
  // not one tile more.
  const capped = max !== undefined && max > 0 && members.length > max;
  const shown = capped ? members.slice(0, Math.max(1, (max ?? 1) - 1)) : members;
  const rest = members.length - shown.length;

  const answered = members.filter((m) => !m.waiting).map((m) => m.name);
  const waiting = members.filter((m) => m.waiting).map((m) => m.name);
  const label =
    given ??
    [
      answered.length > 0 ? `${list(answered)} answered` : null,
      waiting.length > 0
        ? `${list(waiting)} ${waiting.length === 1 ? 'has' : 'have'} not answered yet`
        : null,
    ]
      .filter(Boolean)
      .join('. ');

  return (
    <View style={styles.marks} accessible role="img" aria-label={label}>
      {shown.map((member, index) => (
        <View
          key={`${member.name}-${index}`}
          style={[
            styles.mark,
            {
              width: dimension,
              height: dimension,
              borderRadius: large ? 10 : radius.mark,
              marginLeft: index === 0 || large ? 0 : -markOverlap,
              backgroundColor: color.accentSoft,
              borderColor: palette.ground,
            },
            large && styles.markLarge,
            member.waiting && {
              backgroundColor: 'transparent',
              borderWidth: 1.5,
              borderStyle: 'dashed',
              borderColor: palette.waiting,
            },
          ]}
        >
          <Text
            style={[
              styles.initial,
              {
                fontSize: large ? 14 : 12,
                color: member.waiting ? palette.ink3 : color.accentDark,
              },
            ]}
          >
            {member.name.slice(0, 1).toUpperCase()}
          </Text>
        </View>
      ))}
      {capped ? (
        <View
          style={[
            styles.mark,
            {
              width: dimension,
              height: dimension,
              borderRadius: large ? 10 : radius.mark,
              marginLeft: large ? 0 : -markOverlap,
              backgroundColor: palette.surface,
              borderColor: palette.ground,
            },
            large && styles.markLarge,
          ]}
        >
          <Text
            style={[styles.initial, { fontSize: large ? 14 : 11, color: palette.ink2 }]}
          >{`+${rest}`}</Text>
        </View>
      ) : null}
    </View>
  );
}

function list(names: readonly string[]): string {
  if (names.length === 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const styles = StyleSheet.create({
  marks: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  mark: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  markLarge: {
    borderWidth: 0,
  },
  initial: {
    fontFamily: faceFor('Figtree', 600),
  },
});
