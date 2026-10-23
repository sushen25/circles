import { Pressable, StyleSheet, View } from 'react-native';

import {
  CompactButton,
  DateText,
  Icon,
  Marks,
  Small,
  usePalette,
  type Member,
} from '../../components';
import { Divider, Stack } from '../../components/layout';
import { t } from '../../copy';
import { MARKS_MAX, marksMore, namesLabel } from './lines';

/**
 * The gear in a top bar: the reader's account on the circles list, the
 * circle's settings on its home (the artboards' `ic("gear")`). A 44pt target
 * that says where it goes.
 */
export function GearButton({
  label,
  onPress,
}: {
  label: string;
  onPress?: (() => void) | undefined;
}) {
  const palette = usePalette();
  if (onPress === undefined) return null;
  return (
    <Pressable role="button" aria-label={label} onPress={onPress} hitSlop={10}>
      <Icon name="gear" size={22} color={palette.ink2} />
    </Pressable>
  );
}

export function AccountButton({ onPress }: { onPress?: (() => void) | undefined }) {
  return <GearButton label={t('circlesList', 'account')} onPress={onPress} />;
}

export function SettingsButton({ onPress }: { onPress?: (() => void) | undefined }) {
  return <GearButton label={t('circleHome', 'settings')} onPress={onPress} />;
}

/**
 * The members row every circle-home state ends with: their marks on the left
 * and, whenever no plan is taking answers, **Add someone** on the right (spec
 * §5.2, ADR 0091). The count lives in the header only. Wraps rather than
 * squeezing, so twenty marks and a button never have to fit on one line
 * (ADR 0012).
 */
export function MembersLine({
  members,
  full,
  onAddSomeone,
}: {
  members: readonly Member[];
  /** "Thursday Lot is full (20 people)": said in place of the button at the cap. */
  full?: string | undefined;
  /** Any active member's, while no plan takes answers; absent otherwise. */
  onAddSomeone?: (() => void) | undefined;
}) {
  return (
    <Stack gap={14}>
      <Divider />
      <View style={styles.membersRow}>
        <View style={styles.marks}>
          {/* Plain marks: this row is who is in, never who has answered. */}
          <Marks
            members={members.map((m) => ({ name: m.name }))}
            max={MARKS_MAX}
            more={marksMore}
            label={namesLabel(members.map((m) => m.name))}
          />
        </View>
        {onAddSomeone === undefined ? null : (
          <CompactButton
            label={t('circleHome', 'add_someone')}
            icon="person-add"
            tone="accent"
            onPress={onAddSomeone}
          />
        )}
      </View>
      {full === undefined ? null : <Small accessibilityLiveRegion="polite">{full}</Small>}
    </Stack>
  );
}

/**
 * Last caught up and the next one: a quiet row, not a card, and only once the
 * circle has met (there is nothing to say before that).
 */
export function CatchUpFacts({ lastCaughtUp, nextOne }: { lastCaughtUp: string; nextOne: string }) {
  return (
    <View style={styles.facts}>
      <Stack>
        <Small>{t('circleHome', 'last_caught_up')}</Small>
        <DateText>{lastCaughtUp}</DateText>
      </Stack>
      <Stack>
        <Small>{t('circleHome', 'next_one')}</Small>
        <DateText>{nextOne}</DateText>
      </Stack>
    </View>
  );
}

const styles = StyleSheet.create({
  membersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  marks: { flexShrink: 1 },
  facts: { flexDirection: 'row', gap: 48, paddingHorizontal: 4 },
});
