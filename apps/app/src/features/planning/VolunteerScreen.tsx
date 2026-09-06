import {
  Body,
  BodyText,
  Button,
  DisplayXL,
  Foot,
  Label,
  Notice,
  Screen,
  Small,
  Tertiary,
  TopBar,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * Volunteer — scaffolded from `docs/design/Volunteer.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type VolunteerProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onNotThisOne?: (() => void) | undefined;
  onSendMyTimes?: (() => void) | undefined;
};

export function VolunteerScreen({ onNext, onBack, onNotThisOne, onSendMyTimes }: VolunteerProps) {
  return (
    <Screen>
      <TopBar
        title={t('volunteer', 'sunday_crew')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Stack>
          <Label>{t('volunteer', 'started_quietly')}</Label>
          <DisplayXL>{t('volunteer', 'three_people_are_keen_for_this_weekend')}</DisplayXL>
          <BodyText>{t('volunteer', 'someone_needs_to_pick_the_time_it')}</BodyText>
        </Stack>
        <Row>
          <Small>{t('volunteer', '3_of_6_are_keen_so_far')}</Small>
        </Row>
        <Notice>{t('volunteer', 'this_plan_started_quietly_we_dont_say')}</Notice>
      </Body>
      <Foot>
        <Button label={t('volunteer', 'ill_pick_the_time')} onPress={onNext} />
        <Button
          label={t('volunteer', 'send_my_times')}
          variant="secondary"
          onPress={onSendMyTimes}
        />
        <Tertiary label={t('volunteer', 'not_this_one')} onPress={onNotThisOne} />
      </Foot>
    </Screen>
  );
}
