import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayL,
  Foot,
  Label,
  Marks,
  Screen,
  Small,
  Tertiary,
  Title,
  TopBar,
  Track,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * Waiting — scaffolded from `docs/design/Waiting.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type WaitingProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onEditThePlan?: (() => void) | undefined;
  onShareTheLinkAgain?: (() => void) | undefined;
};

export function WaitingScreen({
  fixture,
  onBack,
  onEditThePlan,
  onShareTheLinkAgain,
}: WaitingProps) {
  return (
    <Screen>
      <TopBar
        title={t('waiting', 'catch_up_next_14_days')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Row>
          <Row>
            <Marks members={fixture.circle.members} />
            <Small>{t('waiting', '2_of_6_replied')}</Small>
          </Row>
          <Small>{t('waiting', 'closes_tue_6_pm')}</Small>
        </Row>
        <Stack>
          <DisplayL>{t('waiting', 'waiting_on_a_few_more')}</DisplayL>
          <BodyText>{t('waiting', 'options_appear_once_at_least_4_people')}</BodyText>
        </Stack>
        <Card>
          <Label>{t('waiting', 'so_far')}</Label>
          <Stack>
            <Row>
              <Title>{t('waiting', 'thu_17_sep')}</Title>
              <BodyText>{t('waiting', '6_30_10_30_pm_works_for')}</BodyText>
            </Row>
            <Track
              day={fixture.plan.dayLabel}
              cells={fixture.plan.cells}
              onChange={() => undefined}
              startMinutes={fixture.plan.startMinutes}
              busy={fixture.plan.busy}
              ticks={fixture.plan.ticks}
            />
            <BodyText>{t('waiting', '5_30_pm')}</BodyText>
            <BodyText>{t('waiting', '8_pm')}</BodyText>
            <BodyText>{t('waiting', '10_30_pm')}</BodyText>
          </Stack>
        </Card>
        <Small>{t('waiting', 'only_you_see_this_while_its_incomplete')}</Small>
      </Body>
      <Foot>
        <Button
          label={t('waiting', 'share_the_link_again')}
          variant="secondary"
          onPress={onShareTheLinkAgain}
        />
        <Tertiary label={t('waiting', 'edit_the_plan')} onPress={onEditThePlan} />
      </Foot>
    </Screen>
  );
}
