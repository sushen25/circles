import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayXL,
  Foot,
  Label,
  Notice,
  Screen,
  Small,
  Tertiary,
  Title,
  TopBar,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * CheckEmail — scaffolded from `docs/design/CheckEmail.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type CheckEmailProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onBackToSundayCrew?: (() => void) | undefined;
  onGetTheApp?: (() => void) | undefined;
  onNotNow?: (() => void) | undefined;
};

export function CheckEmailScreen({
  onBack,
  onBackToSundayCrew,
  onGetTheApp,
  onNotNow,
}: CheckEmailProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <Label>{t('checkEmail', 'sunday_crew')}</Label>
          <DisplayXL>{t('checkEmail', 'check_your_email')}</DisplayXL>
          <BodyText>{t('checkEmail', 'we_sent_a_link_to_priya_example')}</BodyText>
        </Stack>
        <Notice kind="ok">{t('checkEmail', 'your_times_are_already_in_nothing_here')}</Notice>
        <Small>{t('checkEmail', 'wrong_address_use_a_different_one_or')}</Small>
        <Card>
          <Row>
            <Title>{t('checkEmail', 'rather_have_these_on_your_phone')}</Title>
          </Row>
          <BodyText>{t('checkEmail', 'the_app_gives_you_the_same_updates')}</BodyText>
          <Button
            label={t('checkEmail', 'get_the_app')}
            variant="secondary"
            onPress={onGetTheApp}
          />
          <Tertiary label={t('checkEmail', 'not_now')} onPress={onNotNow} />
        </Card>
      </Body>
      <Foot>
        <Button
          label={t('checkEmail', 'back_to_sunday_crew')}
          variant="secondary"
          onPress={onBackToSundayCrew}
        />
      </Foot>
    </Screen>
  );
}
