import { Body, BodyText, Button, DisplayL, Foot, Screen, Small, TopBar } from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import { ShareScreen } from '../sharing/ShareScreen';
import type { ScreenState } from '../state';

/**
 * InviteCircle — `docs/design/InviteCircle.dc.html`.
 *
 * The circle's own link, for adding somebody when there is no plan to answer.
 * It is the same share screen as `PlanShared` with different content, and since
 * ADR 0026 it is no longer a step in the first run: it is reached from circle
 * home, from settings (S1-23), and from "Just invite people for now" on the
 * first plan — so it carries no step label.
 *
 * `expired` is a link that cannot be shown again — one made before links could
 * be (ADR 00XX), or on a deployment without the key — and the way back to one
 * is resetting it from the circle's settings.
 */
export type InviteCircleProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  circleName?: string | undefined;
  link?: string | undefined;
  message?: string | undefined;
  /** What the last tap did, said once: copied, or no share sheet so copied instead. */
  outcome?: 'copied' | 'couldnt_copy' | undefined;
  /** True once the link has left, by the sheet or by a copy. */
  shared?: boolean | undefined;
  onRetry?: (() => void) | undefined;
  /** The screen's one decision: Share to group chat. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onCopyLink?: (() => void) | undefined;
  onSkipForNowIll?: (() => void) | undefined;
  /** From the expired state: where the owner resets the link. */
  onSettings?: (() => void) | undefined;
};

export function InviteCircleScreen({
  fixture,
  state = 'default',
  circleName = fixture?.circle.name ?? '',
  link = t('inviteCircle', 'domain_join_7f3k'),
  message = t('inviteCircle', 'made_a_sunday_crew_circle_so_we'),
  outcome,
  shared = false,
  onRetry,
  onNext,
  onBack,
  onCopyLink,
  onSkipForNowIll,
  onSettings,
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
          {onSettings === undefined ? null : (
            <Button label={t('inviteCircle', 'open_settings')} onPress={onSettings} />
          )}
          <Button
            label={t('inviteCircle', 'go_to_circle', { circle: circleName })}
            variant={onSettings === undefined ? 'primary' : 'secondary'}
            onPress={onSkipForNowIll}
          />
        </Foot>
      </Screen>
    );
  }

  return (
    <ShareScreen
      title={t('inviteCircle', 'now_invite', { circle: circleName })}
      intro={t('inviteCircle', 'paste_one_link_into_the_chat_where')}
      message={message}
      linkTitle={t('inviteCircle', 'join_circle_generic')}
      linkSubtitle={t('inviteCircle', 'pick_the_times_youd_be_up_for')}
      link={link}
      privacy={t('inviteCircle', 'only_people_with_this_link_can_join')}
      outcome={outcome}
      onCopy={onCopyLink}
      onShare={onNext}
      onwardLabel={
        shared
          ? t('inviteCircle', 'go_to_circle', { circle: circleName })
          : t('inviteCircle', 'skip_for_now_ill_plan_first')
      }
      onOnward={onSkipForNowIll}
      onBack={onBack}
    />
  );
}
