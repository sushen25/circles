import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayL,
  Screen,
  Small,
  Tertiary,
  Title,
} from '../../components';
import { Divider, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * AppSheet — scaffolded from `docs/design/AppSheet.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type AppSheetProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onNotNow?: (() => void) | undefined;
};

export function AppSheetScreen({ onNext, onNotNow }: AppSheetProps) {
  return (
    <Screen>
      <Body>
        <Stack>
          <DisplayL>{t('appSheet', 'keep_sunday_crew_on_your_phone')}</DisplayL>
          <BodyText>{t('appSheet', 'everything_here_keeps_working_from_the_link')}</BodyText>
        </Stack>
        <Card>
          <Stack>
            <Title>{t('appSheet', 'one_reminder_before_each_catch_up')}</Title>
            <Small>{t('appSheet', 'and_a_ping_only_when_a_decision')}</Small>
          </Stack>
          <Divider />
          <Stack>
            <Title>{t('appSheet', 'grey_out_your_clashes')}</Title>
            <Small>{t('appSheet', 'reads_your_calendar_on_your_phone_only')}</Small>
          </Stack>
          <Divider />
          <Stack>
            <Title>{t('appSheet', 'never_rejoin_again')}</Title>
            <Small>{t('appSheet', 'your_place_in_every_circle_on_every')}</Small>
          </Stack>
          <Divider />
          <Stack>
            <Title>{t('appSheet', 'start_one_with_another_group')}</Title>
            <Small>{t('appSheet', 'same_link_trick_your_other_friends')}</Small>
          </Stack>
        </Card>
        <Button label={t('appSheet', 'get_the_app')} onPress={onNext} />
        <Tertiary label={t('appSheet', 'not_now')} onPress={onNotNow} />
        <Small>{t('appSheet', 'free_no_ads_well_remember_you_said')}</Small>
      </Body>
    </Screen>
  );
}
