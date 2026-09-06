import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayL,
  Foot,
  Label,
  Screen,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * CancelledOrg — scaffolded from `docs/design/CancelledOrg.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type CancelledOrgProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onPlanAnother?: (() => void) | undefined;
};

export function CancelledOrgScreen({ onNext, onBack, onPlanAnother }: CancelledOrgProps) {
  return (
    <Screen>
      <TopBar
        title={t('cancelledOrg', 'sunday_crew')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Stack>
          <Label>{t('cancelledOrg', 'not_going_ahead')}</Label>
          <DisplayL>{t('cancelledOrg', 'thursdays_catch_up_is_off')}</DisplayL>
          <BodyText>{t('cancelledOrg', 'cancelled_by_you_tue_15_sep_the')}</BodyText>
        </Stack>
        <Card>
          <Label>{t('cancelledOrg', 'ready_to_paste_into_the_group_chat')}</Label>
          <BodyText>{t('cancelledOrg', 'update_thursdays_sunday_crew_catch_up_is')}</BodyText>
        </Card>
      </Body>
      <Foot>
        <Button label={t('cancelledOrg', 'share_to_group_chat')} onPress={onNext} />
        <Button
          label={t('cancelledOrg', 'plan_another')}
          variant="secondary"
          onPress={onPlanAnother}
        />
      </Foot>
    </Screen>
  );
}
