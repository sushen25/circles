import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, type DimensionValue } from 'react-native';

import { radius } from '@circles/tokens';

import { Card } from './Card';
import { usePalette } from './theme';
import { useReducedMotion } from './wait';

/**
 * What a loading screen draws in place of the screen it is loading: grey
 * shapes where the heading, the cards and the buttons will be. Four shapes
 * cover every screen (`home`, `cards`, `list`, `detail`) rather than one per
 * screen (SUS-155).
 *
 * The shapes breathe together, opacity 1 to 0.5 and back over 1.6 s, and hold
 * still under reduced motion. Nothing moves, grows or slides. They are hidden
 * from a screen reader: the sentence above them is the message.
 */
export type SkeletonShape = 'home' | 'cards' | 'list' | 'detail';

export function Skeleton({ shape }: { shape: SkeletonShape }) {
  const reduced = useReducedMotion();
  const [pulse] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (reduced) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.5,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      pulse.setValue(1);
    };
  }, [reduced, pulse]);

  return (
    <View aria-hidden testID="skeleton" style={styles.shape} pointerEvents="none">
      <Animated.View style={[styles.shape, { opacity: pulse }]}>{shapes[shape]()}</Animated.View>
    </View>
  );
}

function Bar({
  width = '100%',
  height = 14,
  round = 8,
}: {
  width?: DimensionValue;
  height?: number;
  round?: number;
}) {
  const palette = usePalette();
  return (
    <View
      style={{ width, height, borderRadius: round, backgroundColor: palette.line, flexShrink: 0 }}
    />
  );
}

function Marks({ count }: { count: number }) {
  const palette = usePalette();
  return (
    <View style={styles.marks}>
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={[
            styles.mark,
            { backgroundColor: palette.line, borderColor: palette.surface },
            i === 0 ? null : { marginLeft: -5 },
          ]}
        />
      ))}
    </View>
  );
}

function Between({ children }: { children: ReactNode }) {
  return <View style={styles.between}>{children}</View>;
}

function Lines({ children, gap = 8 }: { children: ReactNode; gap?: number }) {
  return <View style={{ gap }}>{children}</View>;
}

const shapes: Record<SkeletonShape, () => ReactNode> = {
  // Circle home: who and what, a plan card, a second smaller card, a button.
  home: () => (
    <>
      <View style={styles.header}>
        <Bar width={52} height={52} round={14} />
        <View style={styles.headerLines}>
          <Bar width="60%" height={26} />
          <Bar width="40%" height={12} />
        </View>
      </View>
      <Card>
        <Between>
          <Bar width={90} height={10} />
          <Bar width={110} height={10} />
        </Between>
        <Bar width="75%" height={18} />
        <Between>
          <Marks count={6} />
          <Bar width={80} height={12} />
        </Between>
        <View style={styles.pair}>
          <View style={styles.half}>
            <Bar height={44} round={12} />
          </View>
          <View style={styles.half}>
            <Bar height={44} round={12} />
          </View>
        </View>
      </Card>
      <Card>
        <Between>
          <Lines>
            <Bar width={80} height={10} />
            <Bar width={110} height={22} />
          </Lines>
          <Lines>
            <Bar width={70} height={10} />
            <Bar width={90} height={22} />
          </Lines>
        </Between>
        <Bar width="92%" height={12} />
      </Card>
      <View style={styles.grow} />
      <Bar height={55} round={14} />
    </>
  ),
  // Options and any stack of cards: who replied, a headline, three cards.
  cards: () => (
    <>
      <Between>
        <View style={styles.inline}>
          <Marks count={6} />
          <Bar width={90} height={12} />
        </View>
        <Bar width={80} height={12} />
      </Between>
      <Lines>
        <Bar width="92%" height={26} />
        <Bar width="62%" height={26} />
      </Lines>
      {[0, 1, 2].map((i) => (
        <Card key={i} gap={10}>
          <Between>
            <Bar width={100} height={10} />
            <Bar width={36} height={10} />
          </Between>
          <Lines>
            <Bar width="55%" height={24} />
            <Bar width="38%" height={14} />
          </Lines>
          <Between>
            <Marks count={5} />
            <Bar width={110} height={12} />
          </Between>
        </Card>
      ))}
    </>
  ),
  // A list of rows: a leading square, a title and a line under it.
  list: () => (
    <>
      <Bar width="55%" height={30} />
      <Card gap={18}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={styles.header}>
            <Bar width={44} height={44} round={12} />
            <View style={styles.headerLines}>
              <Bar width="58%" height={16} />
              <Bar width="36%" height={12} />
            </View>
          </View>
        ))}
      </Card>
    </>
  ),
  // The confirmed screen and any detail: the answer, the facts, the people, the buttons.
  detail: () => (
    <>
      <Lines gap={10}>
        <Bar width={80} height={10} />
        <Bar width="62%" height={36} />
        <Bar width="78%" height={36} />
        <Bar width="55%" height={22} />
      </Lines>
      <Card>
        <Bar width={150} height={10} />
        <Bar height={14} />
        <Bar width="86%" height={14} />
        <Bar width="64%" height={14} />
      </Card>
      <Between>
        <Lines>
          <Bar width={130} height={16} />
          <Bar width={100} height={12} />
        </Lines>
        <Marks count={6} />
      </Between>
      <View style={styles.grow} />
      <Lines gap={10}>
        <Bar height={55} round={14} />
        <Bar height={55} round={14} />
      </Lines>
    </>
  ),
};

const styles = StyleSheet.create({
  shape: { flex: 1, gap: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  headerLines: { flex: 1, gap: 8 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pair: { flexDirection: 'row', gap: 8 },
  half: { flex: 1 },
  grow: { flexGrow: 1 },
  marks: { flexDirection: 'row' },
  mark: { width: 28, height: 28, borderRadius: radius.chip, borderWidth: 2 },
});
