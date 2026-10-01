import { Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';

import { color, radius, space } from '@circles/tokens';

import iconLight from '../../assets/icon.png';
import iconDark from '../../assets/icon-dark.png';
import iconTinted from '../../assets/icon-tinted.png';
import androidForeground from '../../assets/android-icon-foreground.png';
import androidMonochrome from '../../assets/android-icon-monochrome.png';
import notificationIcon from '../../assets/notification-icon.png';
import {
  Body,
  BrandLockup,
  BrandMark,
  Card,
  Screen,
  Small,
  Title,
  TopBar,
} from '../../src/components';
import { InvertProvider } from '../../src/components/theme';

/**
 * The brand on one page (SUS-98): lockup on both grounds, the mark at the
 * sizes it is drawn at, and the app icons as `pnpm gen:brand` rendered them.
 * Development only, for catching a regression by eye — the dotted seat at
 * 16 px is the thing most likely to go.
 */
const ICONS: readonly { label: string; source: ImageSourcePropType; ground: string }[] = [
  { label: 'iOS light', source: iconLight, ground: color.ground },
  { label: 'iOS dark', source: iconDark, ground: color.invert },
  { label: 'iOS tinted', source: iconTinted, ground: color.ink },
  {
    label: 'Android foreground',
    source: androidForeground,
    ground: color.ground,
  },
  {
    label: 'Android monochrome',
    source: androidMonochrome,
    ground: color.ink,
  },
  {
    label: 'Notification',
    source: notificationIcon,
    ground: color.ink,
  },
];

const SIZES = [16, 24, 32, 48] as const;

export default function Brand() {
  return (
    <Screen>
      <TopBar title="Brand" />
      <Body>
        <Card>
          <BrandLockup descriptor />
        </Card>
        <InvertProvider value>
          <View style={styles.inverted}>
            <BrandLockup />
          </View>
        </InvertProvider>

        <Title>Mark</Title>
        <View style={styles.row}>
          {SIZES.map((size) => (
            <View key={size} style={styles.cell}>
              <BrandMark size={size} />
              <Small>{size} px</Small>
            </View>
          ))}
        </View>

        <Title>Icons</Title>
        <View style={styles.row}>
          {ICONS.map((icon) => (
            <View key={icon.label} style={styles.cell}>
              <Image
                source={icon.source}
                style={[styles.icon, { backgroundColor: icon.ground }]}
                accessibilityIgnoresInvertColors
              />
              <Small>{icon.label}</Small>
            </View>
          ))}
        </View>
      </Body>
    </Screen>
  );
}

const styles = StyleSheet.create({
  inverted: { backgroundColor: color.invert, padding: space.gutter, borderRadius: radius.control },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: space.section },
  cell: { alignItems: 'center', gap: space.tight },
  icon: { width: 96, height: 96, borderRadius: 22 },
});
