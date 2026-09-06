import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayL,
  Foot,
  Marks,
  Screen,
  Small,
  Title,
  TopBar,
} from '../../components';
import { Divider, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * ContinueAs — scaffolded from `docs/design/ContinueAs.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type ContinueAsProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onImNewHere?: (() => void) | undefined;
};

export function ContinueAsScreen({ fixture, onBack, onImNewHere }: ContinueAsProps) {
  return (
    <Screen>
      <TopBar
        title={t('continueAs', 'sunday_crew')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Stack>
          <DisplayL>{t('continueAs', 'welcome_back_which_one_is_you')}</DisplayL>
          <BodyText>{t('continueAs', 'pick_your_name_to_carry_on_where')}</BodyText>
        </Stack>
        <Card>
          <Marks members={fixture.circle.members} />
          <Stack>
            <Title>{t('continueAs', 'priya')}</Title>
            <Small>{t('continueAs', 'joined_3_sep')}</Small>
          </Stack>
          <Divider />
          <Marks members={fixture.circle.members} />
          <Stack>
            <Title>{t('continueAs', 'alex')}</Title>
            <Small>{t('continueAs', 'joined_3_sep')}</Small>
          </Stack>
          <Divider />
          <Marks members={fixture.circle.members} />
          <Stack>
            <Title>{t('continueAs', 'tom')}</Title>
            <Small>{t('continueAs', 'joined_4_sep')}</Small>
          </Stack>
          <Divider />
          <Marks members={fixture.circle.members} />
          <Stack>
            <Title>{t('continueAs', 'jess')}</Title>
            <Small>{t('continueAs', 'joined_4_sep')}</Small>
          </Stack>
          <Divider />
          <Marks members={fixture.circle.members} />
          <Stack>
            <Title>{t('continueAs', 'sam')}</Title>
            <Small>{t('continueAs', 'joined_5_sep')}</Small>
          </Stack>
        </Card>
      </Body>
      <Foot>
        <Button label={t('continueAs', 'im_new_here')} variant="secondary" onPress={onImNewHere} />
      </Foot>
    </Screen>
  );
}
