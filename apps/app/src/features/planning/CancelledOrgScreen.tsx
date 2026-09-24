import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayL,
  Foot,
  Label,
  Screen,
  Small,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { ScreenState } from '../state';
import { PlanStateScreen } from './states';

/**
 * CancelledOrg — `docs/design/CancelledOrg.dc.html` (spec §5.7, §5.8): the plan
 * is off, and here is the update to paste. The message is the domain's
 * (`EN_SHARE_TEMPLATES.cancelled`), with the organiser's note if there was one.
 */
export type CancelledOrgProps = {
  state?: ScreenState | undefined;
  circleName?: string | undefined;
  /** "Thursday", when the plan had been locked in. */
  day?: string | undefined;
  /** Undefined until the page knows its own origin (a static export's first render). */
  message?: string | undefined;
  shareNotice?: string | undefined;
  onRetry?: (() => void) | undefined;
  /** The screen's one decision: share the update. */
  onNext?: (() => void) | undefined;
  onPlanAnother?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function CancelledOrgScreen({
  state = 'default',
  circleName = t('cancelledOrg', 'sunday_crew'),
  day,
  message,
  shareNotice,
  onRetry,
  onNext,
  onPlanAnother,
  onBack,
}: CancelledOrgProps) {
  if (state !== 'default') {
    return <PlanStateScreen state={state} onRetry={onRetry} onBack={onBack} />;
  }
  return (
    <Screen>
      <TopBar title={circleName} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <Label>{t('cancelledOrg', 'not_going_ahead')}</Label>
          <DisplayL>
            {day === undefined
              ? t('cancelledOrg', 'headline_plain')
              : t('cancelledOrg', 'headline_day', { day })}
          </DisplayL>
          <BodyText>{t('cancelledOrg', 'body', { circle: circleName })}</BodyText>
        </Stack>
        {message === undefined ? null : (
          <Card>
            <Label>{t('cancelledOrg', 'ready_to_paste_into_the_group_chat')}</Label>
            <BodyText selectable>{message}</BodyText>
          </Card>
        )}
        {shareNotice === undefined ? null : (
          <Small accessibilityLiveRegion="polite">{shareNotice}</Small>
        )}
      </Body>
      <Foot>
        <Button
          label={t('cancelledOrg', 'share_to_group_chat')}
          disabled={message === undefined}
          onPress={onNext}
        />
        <Button
          label={t('cancelledOrg', 'plan_another')}
          variant="secondary"
          onPress={onPlanAnother}
        />
      </Foot>
    </Screen>
  );
}
