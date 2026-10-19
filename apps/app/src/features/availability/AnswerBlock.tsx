import { StyleSheet, View } from 'react-native';

import { BodyText, DisplayL, Pills, Small, Tertiary, type Pill } from '../../components';
import { Between, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { BlockKind } from './blocks';
import { DayRow } from './DayRow';
import type { AnswerBlockView, DayRowView } from './view';

/**
 * "When, on those days?" (SUS-236, ADR 0079): the time of day for the days the
 * person tapped, on the first screen. A row of pills, the hours of the chosen
 * one, and "Not the same every day?", which swaps the block in place for "A
 * time for each day": the same choices on a row for each day, and a clock that
 * opens that day's hours. Presentational: the container owns which of the two
 * is on show, and every change leaves as a callback.
 */
type Props = {
  block: AnswerBlockView;
  /** The plan leaves one window: nothing to pick, and the link is "Adjust hours". */
  single: boolean;
  /** "Your hours each evening", on a plan with one window. */
  singleHeading: string;
  expanded: boolean;
  rows: readonly DayRowView[];
  /** Nothing here changes the answer: "I'm easy" is on, or a send is on its way. */
  locked: boolean;
  onChoose?: ((kind: BlockKind) => void) | undefined;
  onExpand?: (() => void) | undefined;
  onCollapse?: (() => void) | undefined;
  onChooseDay?: ((day: number, kind: BlockKind) => void) | undefined;
  onOpenDay?: ((day: number) => void) | undefined;
};

const pills = (choices: readonly { kind: BlockKind; label: string; on: boolean }[]): Pill[] =>
  choices.map((choice) => ({ key: choice.kind, label: choice.label, on: choice.on }));

export function AnswerBlock({
  block,
  single,
  singleHeading,
  expanded,
  rows,
  locked,
  onChoose,
  onExpand,
  onCollapse,
  onChooseDay,
  onOpenDay,
}: Props) {
  if (expanded) {
    return (
      <Stack gap={12}>
        <View style={styles.head}>
          <DisplayL style={styles.heading}>
            {single ? singleHeading : t('availability', 'each_title')}
          </DisplayL>
          <Tertiary
            label={t('availability', 'same_for_every_day')}
            onPress={locked ? undefined : onCollapse}
          />
        </View>
        <Stack gap={0}>
          {rows.map((row, index) => (
            <DayRow
              key={row.key}
              row={row}
              first={index === 0}
              locked={locked}
              onChoose={onChooseDay}
              onOpen={onOpenDay}
            />
          ))}
        </Stack>
      </Stack>
    );
  }

  return (
    <Stack gap={12}>
      <View style={styles.title}>
        <DisplayL style={styles.heading}>
          {single ? singleHeading : t('availability', 'when_on_those_days')}
        </DisplayL>
        <Small>{block.count}</Small>
      </View>
      {block.choices.length === 0 ? null : (
        <Pills
          pills={pills(block.choices)}
          label={t('availability', 'when_on_those_days')}
          disabled={locked}
          onChoose={(kind) => onChoose?.(kind as BlockKind)}
        />
      )}
      <Between>
        <View style={styles.grow} aria-live="polite">
          {block.hours === undefined ? null : <BodyText>{block.hours}</BodyText>}
        </View>
        <Tertiary
          label={t('availability', single ? 'adjust_hours' : 'not_the_same_every_day')}
          onPress={locked ? undefined : onExpand}
        />
      </Between>
    </Stack>
  );
}

const styles = StyleSheet.create({
  title: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  heading: { fontSize: 26, lineHeight: 30, flexShrink: 1 },
  grow: { flexShrink: 1 },
});
