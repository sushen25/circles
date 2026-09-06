import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayL,
  Foot,
  Screen,
  Tertiary,
  Title,
  TopBar,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * ReattachedNudge — scaffolded from `docs/design/ReattachedNudge.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type ReattachedNudgeProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function ReattachedNudgeScreen({ onNext, onBack }: ReattachedNudgeProps) {
  return (
    <Screen>
      <TopBar
        title={t('reattachedNudge', 'sunday_crew')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Stack>
          <DisplayL>{t('reattachedNudge', 'welcome_back_priya')}</DisplayL>
          <BodyText>{t('reattachedNudge', 'youve_rejoined_from_a_new_browser_and')}</BodyText>
        </Stack>
        <Card>
          <Row>
            <Title>{t('reattachedNudge', 'keep_your_place_for_good')}</Title>
          </Row>
          <BodyText>{t('reattachedNudge', 'sign_in_once_with_your_email_apple')}</BodyText>
          <Row>
            <Button label={t('reattachedNudge', 'save_my_place')} onPress={onNext} />
          </Row>
          <Tertiary label={t('reattachedNudge', 'not_now')} onPress={onNext} />
        </Card>
      </Body>
      <Foot>
        <Button
          label={t('reattachedNudge', 'carry_on_to_sunday_crew')}
          variant="secondary"
          onPress={onNext}
        />
      </Foot>
    </Screen>
  );
}
