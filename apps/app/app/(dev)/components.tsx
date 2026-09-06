import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { color, space } from '@circles/tokens';

import {
  Body,
  BodyText,
  Button,
  ButtonRow,
  Card,
  Chip,
  Chips,
  DateText,
  DisplayL,
  DisplayXL,
  Icon,
  type IconName,
  Input,
  Label,
  Marks,
  Notice,
  Radio,
  Screen,
  Sheet,
  Small,
  Tertiary,
  Title,
  Toggle,
  TopBar,
  Track,
} from '../../src/components';

/**
 * Every component in one place, so a change can be eyeballed against
 * `docs/design/Components.dc.html` without hunting through screens. Development
 * only; it is not linked from anywhere in the product.
 */
const ICONS: IconName[] = [
  'back',
  'chevron',
  'check',
  'share',
  'calendar',
  'shield',
  'clock',
  'plus',
  'x',
  'link',
  'mail',
  'pin',
  'gear',
  'eye-off',
  'people',
  'wifi-off',
];

export default function ComponentsScreen() {
  const [selectedChip, setSelectedChip] = useState(true);
  const [toggle, setToggle] = useState(true);
  const [radio, setRadio] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [cells, setCells] = useState<boolean[]>([
    false,
    false,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
  ]);

  return (
    <Screen>
      <TopBar title="Components" right={<Icon name="gear" color={color.ink2} />} />
      <Body>
        <Section label="Type">
          <DisplayXL>Display XL 40</DisplayXL>
          <DisplayL>Display L 31</DisplayL>
          <DateText>Date 24 · Sat 19 Sep</DateText>
          <Title>Title 16 · Figtree 600</Title>
          <BodyText>Body 15 · Figtree 400, line 1.5</BodyText>
          <Small>Small 13</Small>
          <Label>Label 12 · 0.07em</Label>
        </Section>

        <Section label="Buttons">
          <Button label="Primary · names the outcome" />
          <Button label="Secondary" variant="secondary" />
          <Tertiary label="Tertiary · quiet, never hidden" />
          <Chips>
            <Chip label="Chip" selected={false} onPress={() => undefined} />
            <Chip
              label="Selected"
              selected={selectedChip}
              onPress={() => setSelectedChip((v) => !v)}
            />
          </Chips>
        </Section>

        <Section label="Marks and notices">
          <View style={styles.row}>
            <Marks
              members={[
                { name: 'Maya' },
                { name: 'Priya' },
                { name: 'Tom' },
                { name: 'Alex', waiting: true },
              ]}
            />
            <Small>dashed = hasn&rsquo;t answered</Small>
          </View>
          <Notice icon="shield">Advisory notice, one sentence.</Notice>
          <Notice icon="clock" kind="warn">
            Warn: confirming while someone hasn&rsquo;t replied.
          </Notice>
          <Notice icon="check" kind="ok">
            Affirmative only, never a status colour.
          </Notice>
        </Section>

        <Section label="Availability track · fill is the affordance, text is the answer">
          <Track
            day="Thu 17 Sep"
            cells={cells}
            onChange={setCells}
            startMinutes={17 * 60 + 30}
            busy={[0, 1]}
            ticks={['5:30 pm', '8 pm', '10:30 pm']}
          />
          <Small>
            Grey cells: greyed by a local calendar overlay (native only). Always overridable.
          </Small>
        </Section>

        <Section label="Card">
          <Card recommended>
            <Label>Best for the most people</Label>
            <DateText>Thu 17 Sep</DateText>
            <BodyText>6:30 – 8:30 pm</BodyText>
          </Card>
          <Card>
            <Title>An ordinary card</Title>
            <Small>Surface on a hairline, radius 18.</Small>
          </Card>
        </Section>

        <Section label="Inputs">
          <Input placeholder="What should we call this circle?" />
          <View style={styles.row}>
            <BodyText>Email me plan updates</BodyText>
            <Toggle value={toggle} onValueChange={setToggle} label="Email me plan updates" />
          </View>
          <View style={styles.row}>
            <Radio selected={radio === 0} onPress={() => setRadio(0)} label="Every few weeks" />
            <BodyText>Every few weeks</BodyText>
          </View>
          <View style={styles.row}>
            <Radio selected={radio === 1} onPress={() => setRadio(1)} label="Monthly" />
            <BodyText>Monthly</BodyText>
          </View>
        </Section>

        <Section label="Icons">
          <View style={styles.icons}>
            {ICONS.map((name) => (
              <View key={name} style={styles.iconCell}>
                <Icon name={name} color={color.ink} />
                <Small style={styles.iconLabel}>{name}</Small>
              </View>
            ))}
          </View>
        </Section>

        <Section label="Colour">
          <View style={styles.swatches}>
            {(
              [
                ['ground', color.ground],
                ['accent', color.accent],
                ['accent-soft', color.accentSoft],
                ['support', color.support],
                ['ink', color.ink],
                ['ink-2', color.ink2],
                ['ink-3', color.ink3],
                ['invert', color.invert],
              ] as const
            ).map(([name, value]) => (
              <View key={name} style={styles.swatch}>
                <View style={[styles.swatchChip, { backgroundColor: value }]} />
                <Small>{name}</Small>
                <Small>{value}</Small>
              </View>
            ))}
          </View>
        </Section>
      </Body>

      <View style={styles.foot}>
        <ButtonRow>
          <View style={styles.grow}>
            <Button label="Open a sheet" variant="secondary" onPress={() => setSheetOpen(true)} />
          </View>
        </ButtonRow>
      </View>

      <Sheet visible={sheetOpen} onDismiss={() => setSheetOpen(false)} label="Example sheet">
        <Title>Add to calendar</Title>
        <BodyText>A bottom sheet: 22 radius on the top corners, hairline, handle.</BodyText>
        <Button label="Done" onPress={() => setSheetOpen(false)} />
      </Sheet>
    </Screen>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Label>{label}</Label>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  grow: {
    flex: 1,
  },
  foot: {
    paddingHorizontal: space.gutter,
    paddingBottom: 28,
    paddingTop: 12,
  },
  icons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  iconCell: {
    width: 72,
    alignItems: 'center',
    gap: 4,
  },
  iconLabel: {
    fontSize: 11,
  },
  swatches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  swatch: {
    width: '22%',
    gap: 6,
  },
  swatchChip: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.line,
  },
});
