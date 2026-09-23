import { Pressable } from 'react-native';

import { Button, Card, Notice, Sheet, Small, Title } from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';

/**
 * AddToCalendar — `docs/design/AddToCalendar.dc.html` (spec §5.7), a sheet
 * over either confirmed screen rather than a screen of its own; the file keeps
 * the artboard's name so the scaffold never writes a second one.
 *
 * One row for now: **Apple or device calendar**, which downloads the `.ics`
 * `generate-ics` builds. The artboard's Google Calendar row is **held to
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
  busy?: boolean | undefined;
  /** What happened to the last tap, in words. */
  status?: string | undefined;
  onDevice?: (() => void) | undefined;
  onDismiss: () => void;
};

export function AddToCalendarSheet({
  visible,
  title,
  detail,
  busy = false,
  status,
  onDevice,
  onDismiss,
}: AddToCalendarProps) {
  const device = t('addToCalendar', 'apple_or_device_calendar');
  const downloads = t('addToCalendar', 'downloads_an_ics_file');
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
      <Pressable
        role="button"
        aria-label={`${device}. ${downloads}`}
        aria-disabled={busy}
        disabled={busy}
        onPress={onDevice}
      >
        <Card>
          <Stack>
            <Title>{device}</Title>
            <Small>{busy ? t('addToCalendar', 'downloading') : downloads}</Small>
          </Stack>
        </Card>
      </Pressable>
      {status === undefined ? null : <Notice>{status}</Notice>}
      <Small>{t('addToCalendar', 'nothing_is_added_to_anyones_calendar_without')}</Small>
      <Button label={t('addToCalendar', 'cancel')} variant="secondary" onPress={onDismiss} />
    </Sheet>
  );
}
