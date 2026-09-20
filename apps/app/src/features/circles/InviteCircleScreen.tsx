import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayL,
  Foot,
  Label,
  Notice,
  Screen,
  Small,
  Tertiary,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * InviteCircle — `docs/design/InviteCircle.dc.html` (spec §5.1 step 5).
 *
 * The link and the message ready to paste; Share, Copy, or Skip. The link is
 * shown as text, not in a field: there is nothing to type here, and the flow's
 * two typed inputs are already spent.
 *
 * `expired` is the link no longer being in hand — the secret is returned once
 * and only held in memory, so a reload loses it — and the way back to one is
 * resetting it from the circle's settings (S1-23).
 */
export type InviteCircleProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  circleName?: string | undefined;
  link?: string | undefined;
  message?: string | undefined;
  /** What the last tap did, said once: copied, or no share sheet so copied instead. */
  outcome?: 'copied' | 'couldnt_copy' | undefined;
  onRetry?: (() => void) | undefined;
  /** The screen's one decision: Share to group chat. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onCopyLink?: (() => void) | undefined;
  onSkipForNowIll?: (() => void) | undefined;
};

export function InviteCircleScreen({
  fixture,
  state = 'default',
  circleName = fixture?.circle.name ?? '',
  link = t('inviteCircle', 'domain_join_7f3k'),
  message = t('inviteCircle', 'made_a_sunday_crew_circle_so_we'),
  outcome,
  onRetry,
  onNext,
  onBack,
  onCopyLink,
  onSkipForNowIll,
}: InviteCircleProps) {
  if (state === 'loading') {
    return (
      <Screen>
        <TopBar onBack={onBack} backLabel={t('common', 'back')} />
        <Body>
          <Small accessibilityLiveRegion="polite">{t('inviteCircle', 'loading')}</Small>
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
              ? t('inviteCircle', 'youre_offline')
              : t('inviteCircle', 'couldnt_load')}
          </DisplayL>
        </Body>
        <Foot>
          <Button label={t('inviteCircle', 'try_again')} onPress={onRetry} />
        </Foot>
      </Screen>
    );
  }

  if (state === 'expired') {
    return (
      <Screen>
        <TopBar onBack={onBack} backLabel={t('common', 'back')} />
        <Body>
          <Stack>
            <DisplayL>{t('inviteCircle', 'link_not_here', { circle: circleName })}</DisplayL>
            <BodyText>{t('inviteCircle', 'link_shown_once')}</BodyText>
          </Stack>
        </Body>
        <Foot>
          <Button
            label={t('inviteCircle', 'go_to_circle', { circle: circleName })}
            onPress={onSkipForNowIll}
          />
        </Foot>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <Label>{t('inviteCircle', 'step_2_of_2')}</Label>
          <DisplayL>{t('inviteCircle', 'now_invite', { circle: circleName })}</DisplayL>
          <BodyText>{t('inviteCircle', 'paste_one_link_into_the_chat_where')}</BodyText>
        </Stack>
        <Card>
          <Label>{t('inviteCircle', 'your_invite_link')}</Label>
          <BodyText selectable>{link}</BodyText>
          <BodyText selectable>{message}</BodyText>
        </Card>
        <Notice>{t('inviteCircle', 'only_people_with_this_link_can_join')}</Notice>
        {outcome === 'copied' ? <Notice kind="ok">{t('inviteCircle', 'copied')}</Notice> : null}
        {outcome === 'couldnt_copy' ? (
          <Notice kind="warn">{t('inviteCircle', 'couldnt_copy')}</Notice>
        ) : null}
      </Body>
      <Foot>
        <Button label={t('inviteCircle', 'share_to_group_chat')} onPress={onNext} />
        <Button label={t('inviteCircle', 'copy_link')} variant="secondary" onPress={onCopyLink} />
        <Tertiary
          label={
            outcome === 'copied'
              ? t('inviteCircle', 'go_to_circle', { circle: circleName })
              : t('inviteCircle', 'skip_for_now_ill_plan_first')
          }
          onPress={onSkipForNowIll}
        />
      </Foot>
    </Screen>
  );
}
