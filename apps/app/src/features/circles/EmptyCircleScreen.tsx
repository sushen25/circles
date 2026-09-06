import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayL,
  Foot,
  Input,
  Label,
  Screen,
  Small,
  TopBar,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * EmptyCircle — scaffolded from `docs/design/EmptyCircle.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type EmptyCircleProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onPlanACatchUp?: (() => void) | undefined;
};

export function EmptyCircleScreen({ onNext, onBack, onPlanACatchUp }: EmptyCircleProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Row>
          <Stack>
            <DisplayL>{t('emptyCircle', 'sunday_crew')}</DisplayL>
            <Small>{t('emptyCircle', 'just_you_so_far')}</Small>
          </Stack>
        </Row>
        <Card>
          <Label>{t('emptyCircle', 'invite_link')}</Label>
          <BodyText>{t('emptyCircle', 'paste_this_into_the_group_chat_friends')}</BodyText>
          <Input placeholder={t('emptyCircle', 'domain_join_7f3k')} />
        </Card>
        <Small>{t('emptyCircle', 'you_can_start_a_plan_now_too')}</Small>
      </Body>
      <Foot>
        <Button label={t('emptyCircle', 'share_invite_link')} onPress={onNext} />
        <Button
          label={t('emptyCircle', 'plan_a_catch_up_anyway')}
          variant="secondary"
          onPress={onPlanACatchUp}
        />
      </Foot>
    </Screen>
  );
}
