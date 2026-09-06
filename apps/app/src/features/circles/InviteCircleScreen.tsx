import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayL,
  Foot,
  Input,
  Label,
  Notice,
  Screen,
  Tertiary,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * InviteCircle — scaffolded from `docs/design/InviteCircle.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type InviteCircleProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function InviteCircleScreen({ onNext, onBack }: InviteCircleProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <Label>{t('inviteCircle', 'step_2_of_2')}</Label>
          <DisplayL>{t('inviteCircle', 'now_invite_sunday_crew')}</DisplayL>
          <BodyText>{t('inviteCircle', 'paste_one_link_into_the_chat_where')}</BodyText>
        </Stack>
        <Card>
          <Label>{t('inviteCircle', 'your_invite_link')}</Label>
          <Input placeholder={t('inviteCircle', 'domain_join_7f3k')} />
          <BodyText>{t('inviteCircle', 'made_a_sunday_crew_circle_so_we')}</BodyText>
        </Card>
        <Notice>{t('inviteCircle', 'only_people_with_this_link_can_join')}</Notice>
      </Body>
      <Foot>
        <Button label={t('inviteCircle', 'share_to_group_chat')} onPress={onNext} />
        <Button label={t('inviteCircle', 'copy_link')} variant="secondary" onPress={onNext} />
        <Tertiary label={t('inviteCircle', 'skip_for_now_ill_plan_first')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}
