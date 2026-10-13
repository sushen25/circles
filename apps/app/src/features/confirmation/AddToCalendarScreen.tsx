import { StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  Icon,
  ListRow,
  Notice,
  Sheet,
  Small,
  Tertiary,
  Title,
  usePalette,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { CalendarPhase } from './useCalendar';

/**
 * AddToCalendar — `docs/design/AddToCalendar.dc.html` (spec §5.7), a sheet
 * over either confirmed screen rather than a screen of its own; the file keeps
 * the artboard's name so the scaffold never writes a second one.
 *
 * One row for now: **Apple or device calendar**, which downloads the `.ics`
 * `generate-ics` builds. The row is never a still card (SUS-154): while the
 * file is on its way it is busy ("Getting it ready…", then "Still working on
 * it…"); when the fetch failed it says so and offers "Try again" inside it;
 * when it is ready it says what the tap does on this device. The artboard's Google Calendar row is **held to
 * Slice 3** (founder decision), so it is not drawn at all rather than drawn
 * and disabled. The line under the rows is the privacy promise at the point it
 * is felt (manifesto §3.8): nothing lands in a calendar without a tap.
 */
export type AddToCalendarProps = {
  visible: boolean;
  /** "Add Thursday to your calendar". */
  title: string;
  /** "Thu 17 Sep, 6:30–8:30 pm · Hope St Radio". */
  detail: string;
  /** Where the file is: on its way, here, or failed. */
  phase: CalendarPhase;
  /** What the tap does on this device ("Saves the event for Calendar"). */
  ready: string;
  /** Why the fetch failed, in words; shown in the row. */
  problem?: string | undefined;
  /** What happened to the last tap, in words. */
  status?: string | undefined;
  onDevice?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onDismiss: () => void;
};

export function AddToCalendarSheet({
  visible,
  title,
  detail,
  phase,
  ready,
  problem,
  status,
  onDevice,
  onRetry,
  onDismiss,
}: AddToCalendarProps) {
  const palette = usePalette();
  const device = t('addToCalendar', 'apple_or_device_calendar');
  const leading = <Icon name="calendar" size={22} color={palette.accent} />;
  return (
    <Sheet
      visible={visible}
      onDismiss={onDismiss}
      label={title}
      dismissLabel={t('addToCalendar', 'cancel')}
    >
      <Stack>
        <Title>{title}</Title>
        <Small>{detail}</Small>
      </Stack>
      <Card>
        {phase === 'failed' ? (
          <View style={styles.failed}>
            {leading}
            <View style={styles.words}>
              <Title>{device}</Title>
              <Small accessibilityLiveRegion="polite">
                {problem ?? t('addToCalendar', 'failed')}
              </Small>
            </View>
            <Tertiary label={t('common', 'try_again')} onPress={onRetry} />
          </View>
        ) : (
          <ListRow
            title={device}
            detail={phase === 'ready' ? ready : t('addToCalendar', 'preparing')}
            label={`${device}. ${phase === 'ready' ? ready : t('addToCalendar', 'preparing')}`}
            leading={leading}
            busy={phase !== 'ready'}
            onPress={onDevice}
          />
        )}
      </Card>
      {status === undefined ? null : <Notice>{status}</Notice>}
      <Small>{t('addToCalendar', 'nothing_is_added_to_anyones_calendar_without')}</Small>
      <Button label={t('addToCalendar', 'cancel')} variant="secondary" onPress={onDismiss} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  failed: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44 },
  words: { flex: 1, gap: 2 },
});
