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
  Tertiary,
  Title,
  TopBar,
  struck,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { ScreenState } from '../state';
import { PlanStateScreen } from './states';

/**
 * RescheduledGuest — `docs/design/RescheduledGuest.dc.html` (spec §5.7):
 * "Thursday is off the table" and a fresh ask. The old time is struck through
 * under a "Previously" label, so the strike is never the only signal.
 */
export type RescheduledGuestProps = {
  state?: ScreenState | undefined;
  circleName?: string | undefined;
  day?: string | undefined;
  organiserName?: string | undefined;
  /** "Thu 17 Sep, 6:30–8:30 pm". */
  previously?: string | undefined;
  /** "Mon 21 – Sun 27 Sep". */
  nowAsking?: string | undefined;
  onRetry?: (() => void) | undefined;
  /** The screen's one decision: choose my times. */
  onNext?: (() => void) | undefined;
  onNotThisTime?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function RescheduledGuestScreen({
  state = 'default',
  circleName = t('rescheduledGuest', 'sunday_crew'),
  day,
  organiserName,
  previously = t('rescheduledGuest', 'thu_17_sep_6_30_8_30'),
  nowAsking = t('rescheduledGuest', 'mon_21_sun_27_sep'),
  onRetry,
  onNext,
  onNotThisTime,
  onBack,
}: RescheduledGuestProps) {
  if (state !== 'default') {
    return <PlanStateScreen state={state} onRetry={onRetry} onBack={onBack} />;
  }
  return (
    <Screen>
      <TopBar title={circleName} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <Label>{t('rescheduledGuest', 'change_of_plan')}</Label>
          <DisplayXL>
            {day === undefined
              ? t('rescheduledGuest', 'headline_plain')
              : t('rescheduledGuest', 'headline_day', { day })}
          </DisplayXL>
          <BodyText>
            {organiserName === undefined
              ? t('rescheduledGuest', 'body_plain')
              : t('rescheduledGuest', 'body_named', { name: organiserName })}
          </BodyText>
        </Stack>
        <Card>
          <Stack>
            <Small>{t('rescheduledGuest', 'previously')}</Small>
            <BodyText style={struck}>{previously}</BodyText>
          </Stack>
          <Stack>
            <Small>{t('rescheduledGuest', 'now_asking_about')}</Small>
            <Title>{nowAsking}</Title>
          </Stack>
        </Card>
      </Body>
      <Foot>
        <Button label={t('rescheduledGuest', 'choose_my_times')} onPress={onNext} />
        <Tertiary label={t('rescheduledGuest', 'not_this_time')} onPress={onNotThisTime} />
      </Foot>
    </Screen>
  );
}
