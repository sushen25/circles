import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayXL,
  Foot,
  Label,
  Screen,
  Small,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { ScreenState } from '../state';
import { PlanStateScreen } from './states';

/**
 * CancelledGuest — `docs/design/CancelledGuest.dc.html` (spec §5.7): what a
 * member sees on the plan's link once it is off, with the organiser's note.
 * Nothing to do and nothing to undo: the record is unchanged and nothing they
 * sent was shared.
 */
export type CancelledGuestProps = {
  state?: ScreenState | undefined;
  circleName?: string | undefined;
  day?: string | undefined;
  organiserName?: string | undefined;
  /** The organiser's own words. Content: shown, never logged. */
  note?: string | undefined;
  onRetry?: (() => void) | undefined;
  onBackToCircle?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function CancelledGuestScreen({
  state = 'default',
  circleName = t('cancelledGuest', 'sunday_crew'),
  day,
  organiserName,
  note,
  onRetry,
  onBackToCircle,
  onBack,
}: CancelledGuestProps) {
  if (state !== 'default') {
    return <PlanStateScreen state={state} onRetry={onRetry} onBack={onBack} />;
  }
  return (
    <Screen>
      <TopBar title={circleName} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <Label>{t('cancelledGuest', 'not_going_ahead')}</Label>
          <DisplayXL>
            {day === undefined
              ? t('cancelledGuest', 'headline_plain')
              : t('cancelledGuest', 'headline_day', { day })}
          </DisplayXL>
          <BodyText>
            {organiserName === undefined
              ? t('cancelledGuest', 'body')
              : t('cancelledGuest', 'body_named', { name: organiserName })}
          </BodyText>
        </Stack>
        {note === undefined ? null : (
          <Card>
            <Stack>
              <Small>
                {organiserName === undefined
                  ? t('cancelledGuest', 'note_label')
                  : t('cancelledGuest', 'note_label_named', { name: organiserName })}
              </Small>
              <BodyText>{t('cancelledGuest', 'note', { detail: note })}</BodyText>
            </Stack>
          </Card>
        )}
      </Body>
      <Foot>
        <Button
          label={t('cancelledGuest', 'back_to_circle', { circle: circleName })}
          variant="secondary"
          onPress={onBackToCircle}
        />
      </Foot>
    </Screen>
  );
}
