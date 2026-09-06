import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayXL,
  Foot,
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
 * PlanShared — scaffolded from `docs/design/PlanShared.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type PlanSharedProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function PlanSharedScreen({ onNext, onBack }: PlanSharedProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <Label>{t('planShared', 'sunday_crew')}</Label>
          <DisplayXL>{t('planShared', 'now_tell_the_group')}</DisplayXL>
          <BodyText>{t('planShared', 'paste_this_into_the_chat_where_everyone')}</BodyText>
        </Stack>
        <Card>
          <BodyText>{t('planShared', 'when_can_sunday_crew_actually_catch_up')}</BodyText>
          <Row>
            <Button label={t('planShared', 'copy')} variant="secondary" onPress={onNext} />
            <Button label={t('planShared', 'share')} variant="secondary" onPress={onNext} />
          </Row>
        </Card>
        <Small>{t('planShared', 'replies_close_tue_15_sep_6_pm')}</Small>
      </Body>
      <Foot>
        <Button label={t('planShared', 'done')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}
