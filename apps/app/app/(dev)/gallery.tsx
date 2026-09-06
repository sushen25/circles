import { Link } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { color, space } from '@circles/tokens';

import { Body, Chip, Chips, Screen, Small, Title, TopBar } from '../../src/components';
import { Divider } from '../../src/components/layout';
import { FIXTURES, type FixtureName } from '../../src/data/fixtures';
import SCREENS from '../../src/features/manifest';

/**
 * Every screen, by context, with the fixture switch — for visual review
 * (S0-08). Development only; not linked from anywhere in the product.
 *
 * The eight states live on each screen's `state` prop. A screen appears here
 * once per fixture rather than once per state, because which states a screen
 * can actually be in is a property of that screen: the gallery links to it and
 * the screen decides.
 */
export default function Gallery() {
  const [fixture, setFixture] = useState<FixtureName>('partial');

  const byContext = SCREENS.reduce<Record<string, typeof SCREENS>>((acc, entry) => {
    (acc[entry.feature] ??= []).push(entry);
    return acc;
  }, {});

  return (
    <Screen>
      <TopBar title="Gallery" />
      <Body>
        <Small>
          {SCREENS.length} screens. Pick a scenario, then open any screen — the fixture follows.
        </Small>
        <Chips>
          {(Object.keys(FIXTURES) as FixtureName[]).map((name) => (
            <Chip
              key={name}
              label={name}
              selected={fixture === name}
              onPress={() => setFixture(name)}
            />
          ))}
        </Chips>

        {Object.entries(byContext)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([context, entries]) => (
            <View key={context} style={styles.section}>
              <Title>{context}</Title>
              <Divider />
              <ScrollView>
                {entries.map((entry) => (
                  <Link
                    key={entry.screen}
                    href={{ pathname: entry.href, params: { fixture } }}
                    style={styles.link}
                  >
                    {entry.screen}
                  </Link>
                ))}
              </ScrollView>
            </View>
          ))}
      </Body>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  link: {
    paddingVertical: 10,
    color: color.accentDark,
    fontSize: 15,
    paddingHorizontal: space.tight,
  },
});
