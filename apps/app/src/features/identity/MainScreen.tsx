import {
  Body,
  BodyText,
  Button,
  DisplayXL,
  Foot,
  Label,
  Marks,
  Notice,
  Screen,
  Small,
  Tertiary,
  TopBar,
} from '../../components';
import { Row } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * Main — scaffolded from `docs/design/Main.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type MainProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onWhatIsBrand?: (() => void) | undefined;
};

export function MainScreen({ fixture, onNext, onBack, onWhatIsBrand }: MainProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Label>{t('main', 'youre_invited')}</Label>
        <DisplayXL>{t('main', 'sunday_crew_is_finding_a_time_to')}</DisplayXL>
        <BodyText>{t('main', 'maya_shared_this_link_pick_the_times')}</BodyText>
        <Row>
          <Marks members={fixture.circle.members} />
          <Small>{t('main', '5_people_are_in_so_far')}</Small>
        </Row>
        <Notice>{t('main', 'no_account_or_app_needed_your_friends')}</Notice>
      </Body>
      <Foot>
        <Button label={t('main', 'choose_my_times')} onPress={onNext} />
        <Tertiary label={t('main', 'what_is_brand')} onPress={onWhatIsBrand} />
      </Foot>
    </Screen>
  );
}
