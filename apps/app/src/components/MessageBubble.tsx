import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { faceFor, radius } from '@circles/tokens';

import { Icon } from './Icon';
import { Small } from './Text';
import { usePalette } from './theme';

/**
 * A message as the group chat will show it: a tinted bubble on the right with a
 * tail and no border, "To {group}" with a chat glyph above it and, optionally,
 * a quiet line under it (SUS-247). Drawn so it cannot be taken for a field:
 * nothing about it is a box with a hairline, and nothing in it is pressable.
 *
 * One component for every screen that shows a message the person is about to
 * send: the first run's first screen (the first line, filling in as they
 * type), its share screen (the same bubble with the real link) and circle home.
 *
 * `mark` names the pieces of the message that carry the accent: the group's
 * name and the link. They are found in the text, so the caller passes the
 * message as the domain wrote it and not a template of parts.
 */
export type MessageBubbleProps = {
  /** The message, as sent. */
  message: string;
  /** Substrings of `message` set in the accent: the group's name, the link. */
  mark?: readonly string[] | undefined;
  /** "To Thursday Lot". Absent, no label. */
  to?: string | undefined;
  /** The quiet line under the bubble: "No app, no account." */
  caption?: string | undefined;
  /** The name is not typed yet: shown in the placeholder's quieter ink. */
  hollow?: readonly string[] | undefined;
};

/** The message cut into runs, each marked or not. */
export function runsOf(
  message: string,
  mark: readonly string[],
): { text: string; marked: boolean }[] {
  const found = mark.filter((piece) => piece !== '' && message.includes(piece));
  if (found.length === 0) return [{ text: message, marked: false }];
  const pattern = new RegExp(
    `(${found.map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
  );
  return message
    .split(pattern)
    .filter((text) => text !== '')
    .map((text) => ({ text, marked: found.includes(text) }));
}

export function MessageBubble({
  message,
  mark = [],
  to,
  caption,
  hollow = [],
}: MessageBubbleProps) {
  const palette = usePalette();
  const runs = runsOf(message, mark);

  return (
    <View style={styles.figure}>
      {to === undefined ? null : (
        <View style={styles.label}>
          <Icon name="chat" size={16} color={palette.ink2} />
          <Small style={styles.labelText} numberOfLines={1}>
            {to}
          </Small>
        </View>
      )}
      <View style={styles.row}>
        <View style={[styles.bubble, { backgroundColor: palette.softFill }]}>
          <Text selectable style={[styles.text, { color: palette.ink }]}>
            {runs.map((run, index) => (
              <Text
                key={index}
                style={
                  run.marked
                    ? {
                        color: hollow.includes(run.text) ? palette.ink3 : palette.softInk,
                        fontFamily: faceFor('Figtree', 600),
                      }
                    : undefined
                }
              >
                {run.text}
              </Text>
            ))}
          </Text>
          <Svg width={12} height={16} viewBox="0 0 12 16" style={styles.tail} aria-hidden>
            <Path d="M0 0C1 9 5 14.5 12 16H0z" fill={palette.softFill} />
          </Svg>
        </View>
      </View>
      {caption === undefined ? null : <Small style={styles.caption}>{caption}</Small>}
    </View>
  );
}

const styles = StyleSheet.create({
  figure: { gap: 8 },
  label: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  labelText: { fontFamily: faceFor('Figtree', 600), flexShrink: 1 },
  row: { alignItems: 'flex-end', paddingLeft: 48 },
  bubble: {
    borderRadius: radius.card,
    borderBottomRightRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxWidth: '100%',
  },
  text: {
    fontFamily: faceFor('Figtree', 400),
    fontSize: 16,
    lineHeight: 24,
  },
  // Hangs off the bubble's bottom right corner, in the bubble's own colour.
  tail: { position: 'absolute', right: -6, bottom: 0 },
  caption: { textAlign: 'right' },
});
