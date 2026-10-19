import { StyleSheet, View } from 'react-native';

import { Button, DisplayL, Sheet, Small, Tertiary } from '../../components';
import { t } from '../../copy';
import { HoursEditor } from './HoursEditor';
import type { DayRowView } from './view';

/**
 * One day's hours, from its clock (SUS-236, ADR 0079): the app's sheet over the
 * dimmed screen, the day and its hours, and the From – to editor of ADR 0068
 * unchanged. Changes apply as they are made. Done and dismissing are the same
 * thing; "Back to Evening instead" drops the exact hours for the choice the day
 * had before the clock was tapped, when it had one.
 */
type Props = {
  row: DayRowView | undefined;
  busy: boolean;
  /** "Evening": what the day was before; absent when it had hours of its own. */
  backTo: string | undefined;
  onPaint?: ((day: number, cells: boolean[]) => void) | undefined;
  onDone?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function DayHoursSheet({ row, busy, backTo, onPaint, onDone, onBack }: Props) {
  return (
    <Sheet
      visible={row !== undefined}
      onDismiss={() => onDone?.()}
      label={row?.spoken ?? ''}
      dismissLabel={t('availability', 'sheet_dismiss')}
    >
      {row === undefined ? null : (
        <>
          <View style={styles.head}>
            <DisplayL style={styles.day}>{row.name}</DisplayL>
            <Small>{row.range}</Small>
          </View>
          <HoursEditor card={row} dimmed={busy} onPaint={onPaint} />
          <Button label={t('availability', 'done')} onPress={onDone} />
          {backTo === undefined ? null : (
            <Tertiary
              tone="plain"
              label={t('availability', 'back_to_choice', { choice: backTo })}
              onPress={busy ? undefined : onBack}
            />
          )}
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  day: { fontSize: 32, lineHeight: 36 },
});
