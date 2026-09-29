import { StyleSheet, Text as RNText, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { brand } from '@circles/config';
import { faceFor, fontFamily } from '@circles/tokens';

import { Body } from './Text';
import { usePalette } from './theme';

/**
 * The mark, "Room at the table" (SUS-98): five lozenges around a shared
 * empty centre, and the sixth seat drawn as a dotted outline. The vector
 * masters are `assets/brand/wenna-mark.svg` and `wenna-mark-small.svg`; the
 * numbers below are theirs, and `Brand.test.tsx` reads both files and fails if
 * they stop agreeing. Nothing may be added around the mark.
 *
 * The colour is the palette's accent, so on the confirmed screen's inverted
 * ground it turns peach by itself, which is the brand's dark variant.
 */
export const MARK = {
  viewBox: 120,
  lozenge: { x: 49, y: 6, width: 22, height: 40, rx: 11 },
  /** Five seats taken and the open one, at 60° steps. */
  seats: [0, 60, 120, 180, 240],
  open: 300,
  /** At or below `smallAt` px, the small master's heavier dots, so the seat stays visible. */
  smallAt: 32,
  dots: { regular: { width: 4, dash: '0.5 7' }, small: { width: 8, dash: '0.5 11' } },
} as const;

type MarkProps = { size?: number };

export function BrandMark({ size = 40 }: MarkProps) {
  const palette = usePalette();
  const { x, y, width, height, rx } = MARK.lozenge;
  const dots = size <= MARK.smallAt ? MARK.dots.small : MARK.dots.regular;
  const centre = MARK.viewBox / 2;
  const turn = (degrees: number) => `rotate(${degrees} ${centre} ${centre})`;

  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${MARK.viewBox} ${MARK.viewBox}`}
      aria-hidden
      testID="brand-mark"
    >
      {MARK.seats.map((degrees) => (
        <Rect
          key={degrees}
          x={x}
          y={y}
          width={width}
          height={height}
          rx={rx}
          fill={palette.accent}
          transform={turn(degrees)}
        />
      ))}
      <Rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={rx}
        fill="none"
        stroke={palette.accent}
        strokeWidth={dots.width}
        strokeDasharray={dots.dash}
        strokeLinecap="round"
        transform={turn(MARK.open)}
      />
    </Svg>
  );
}

type LockupProps = {
  /** The mark's height; the wordmark is set in proportion, as in `wenna-lockup.svg`. */
  size?: number;
  /** "Plans with friends" beneath — on the landing and sign-in screens. */
  descriptor?: boolean;
};

/**
 * Mark and wordmark: lowercase, Newsreader 400, tracked in to about -0.03em.
 * Never capitals and never the interface face.
 *
 * It is the screen's first heading and reads as the product name, so a screen
 * reader hears `brand.name` once rather than the lowercase letters spelled out.
 */
export function BrandLockup({ size = 36, descriptor = false }: LockupProps) {
  const palette = usePalette();
  // The master sets 88 px type beside a 120 px mark.
  const fontSize = Math.round((size * 88) / 120);

  return (
    <View style={styles.column}>
      <View
        style={[styles.row, { gap: Math.round(size / 10) }]}
        accessibilityRole="header"
        aria-label={brand.name}
      >
        <BrandMark size={size} />
        <RNText
          aria-hidden
          style={[
            styles.wordmark,
            {
              color: palette.ink,
              fontSize,
              lineHeight: Math.round(fontSize * 1.15),
              letterSpacing: fontSize * -0.03,
            },
          ]}
        >
          {brand.name.toLowerCase()}
        </RNText>
      </View>
      {descriptor ? <Body>{brand.descriptor}</Body> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center' },
  wordmark: { fontFamily: faceFor(fontFamily.display, 400) },
});
