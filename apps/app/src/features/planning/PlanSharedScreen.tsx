import {
  Body,
  BodyText,
  Button,
  ButtonRow,
  Card,
  DisplayL,
  DisplayXL,
  Foot,
  Label,
  Notice,
  Screen,
  Small,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * PlanShared — `docs/design/PlanShared.dc.html` (spec §5.1 step 8): the plan's
 * message, ready to paste; Copy, Share, Done.
 *
 * The message is the domain's (`newPlanMessage`), never composed here. The plan
 * link carries no secret (ADR 0022), so it can be shown and copied freely.
 */
export type PlanSharedProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  circleName?: string | undefined;
  message?: string | undefined;
  /** "Replies close Tue 15 Sep, 6 pm. We'll show you …". */
  closes?: string | undefined;
  outcome?: 'copied' | 'couldnt_copy' | undefined;
  onRetry?: (() => void) | undefined;
  /** The screen's one decision: Done. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onCopy?: (() => void) | undefined;
  onShare?: (() => void) | undefined;
};

export function PlanSharedScreen({
  state = 'default',
  circleName = t('planShared', 'sunday_crew'),
  message = t('planShared', 'when_can_sunday_crew_actually_catch_up'),
  closes = t('planShared', 'replies_close_tue_15_sep_6_pm'),
  outcome,
  onRetry,
  onNext,
  onBack,
  onCopy,
  onShare,
}: PlanSharedProps) {
  if (state === 'loading') {
    return (
      <Screen>
        <TopBar onBack={onBack} backLabel={t('common', 'back')} />
        <Body>
          <Small accessibilityLiveRegion="polite">{t('planShared', 'loading')}</Small>
        </Body>
      </Screen>
    );
  }
  if (state === 'error' || state === 'offline') {
    return (
      <Screen>
        <TopBar onBack={onBack} backLabel={t('common', 'back')} />
        <Body>
          <DisplayL>
            {state === 'offline'
              ? t('planShared', 'youre_offline')
              : t('planShared', 'couldnt_load')}
          </DisplayL>
        </Body>
        <Foot>
          <Button label={t('planShared', 'try_again')} onPress={onRetry} />
        </Foot>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <Label>{circleName}</Label>
          <DisplayXL>{t('planShared', 'now_tell_the_group')}</DisplayXL>
          <BodyText>{t('planShared', 'paste_this_into_the_chat_where_everyone')}</BodyText>
        </Stack>
        <Card>
          <BodyText selectable>{message}</BodyText>
          <ButtonRow>
            <Button label={t('planShared', 'copy')} variant="secondary" onPress={onCopy} />
            <Button label={t('planShared', 'share')} variant="secondary" onPress={onShare} />
          </ButtonRow>
        </Card>
        {outcome === 'copied' ? <Notice kind="ok">{t('planShared', 'copied')}</Notice> : null}
        {outcome === 'couldnt_copy' ? (
          <Notice kind="warn">{t('planShared', 'couldnt_copy')}</Notice>
        ) : null}
        <Small>{closes}</Small>
      </Body>
      <Foot>
        <Button label={t('planShared', 'done')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}
