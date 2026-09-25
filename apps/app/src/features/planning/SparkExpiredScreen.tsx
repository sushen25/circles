import {
  Body,
  BodyText,
  Button,
  DisplayXL,
  Foot,
  Label,
  Screen,
  Small,
  Tertiary,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * SparkExpired — `docs/design/SparkExpired.dc.html` (spec §5.4.7): **only the
 * person who asked**, only for an ask that reached its stop time without
 * opening (`showClosedNotice`). Everybody else sees a closed ask as nothing.
 *
 * The headline is SUS-49's softer one. It is also what an ask held to its stop
 * time beside a running plan says, on purpose: "enough people were keen, but"
 * would tell the initiator a count they were never meant to learn.
 */
export type SparkExpiredProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  circleName?: string | undefined;
  backLabel?: string | undefined;
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onBackToSundayCrew?: (() => void) | undefined;
  onTryAgainAnotherTime?: (() => void) | undefined;
};

export function SparkExpiredScreen({
  circleName = t('sparkExpired', 'sunday_crew'),
  backLabel = t('sparkExpired', 'back_to_sunday_crew'),
  onBack,
  onBackToSundayCrew,
  onTryAgainAnotherTime,
}: SparkExpiredProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <Label>{circleName}</Label>
          <DisplayXL>{t('sparkExpired', 'headline')}</DisplayXL>
          <BodyText>{t('sparkExpired', 'body')}</BodyText>
        </Stack>
        <Small>{t('sparkExpired', 'hint')}</Small>
      </Body>
      <Foot>
        <Button
          label={t('sparkExpired', 'try_again_another_time')}
          variant="secondary"
          onPress={onTryAgainAnotherTime}
        />
        <Tertiary label={backLabel} onPress={onBackToSundayCrew} />
      </Foot>
    </Screen>
  );
}
