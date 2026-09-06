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
 * SparkExpired — scaffolded from `docs/design/SparkExpired.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type SparkExpiredProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function SparkExpiredScreen({ onNext, onBack }: SparkExpiredProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <Label>{t('sparkExpired', 'sunday_crew')}</Label>
          <DisplayXL>{t('sparkExpired', 'not_enough_people_were_free_this_time')}</DisplayXL>
          <BodyText>{t('sparkExpired', 'this_one_closed_quietly_nobody_else_knows')}</BodyText>
        </Stack>
        <Small>{t('sparkExpired', 'weekends_have_been_tight_for_a_few')}</Small>
      </Body>
      <Foot>
        <Button
          label={t('sparkExpired', 'try_again_another_time')}
          variant="secondary"
          onPress={onNext}
        />
        <Tertiary label={t('sparkExpired', 'back_to_sunday_crew')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}
