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
 * ReattachedNudge — `docs/design/ReattachedNudge.dc.html` (spec §5.11): "Keep
 * your place for good?", once, straight after a Continue-as from the list.
 * `ReattachedNudgeFlow` decides whether it is shown.
 *
 * Two ways past it and neither is disguised: "Not now" in the card and "Carry
 * on to {circle}" at the foot both dismiss it and show the page underneath.
 */
export type ReattachedNudgeProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  circleName?: string | undefined;
  /** The name they continued as. */
  name?: string | undefined;
  /** Save my place. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onCarryOn?: (() => void) | undefined;
  onNotNow?: (() => void) | undefined;
};

export function ReattachedNudgeScreen({
  circleName = '',
  name,
  onNext,
  onBack,
  onCarryOn,
  onNotNow,
}: ReattachedNudgeProps) {
  return (
    <Screen>
      <TopBar title={circleName} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <DisplayL accessibilityLiveRegion="polite">
            {name === undefined
              ? t('reattachedNudge', 'welcome_back')
              : t('reattachedNudge', 'welcome_back_name', { name })}
          </DisplayL>
          <BodyText>{t('reattachedNudge', 'youve_rejoined_from_a_new_browser_and')}</BodyText>
        </Stack>
        <Card>
          <Row>
            <Title>{t('reattachedNudge', 'keep_your_place_for_good')}</Title>
          </Row>
          <BodyText>{t('reattachedNudge', 'sign_in_once_with_your_email')}</BodyText>
          <Row>
            <Button label={t('reattachedNudge', 'save_my_place')} onPress={onNext} />
          </Row>
          <Tertiary label={t('reattachedNudge', 'not_now')} onPress={onNotNow} />
        </Card>
      </Body>
      <Foot>
        <Button
          label={t('reattachedNudge', 'carry_on_to_circle', { circle: circleName })}
          variant="secondary"
          onPress={onCarryOn}
        />
      </Foot>
    </Screen>
  );
}
