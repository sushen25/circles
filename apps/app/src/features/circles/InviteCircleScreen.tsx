import {
  Body,
  BodyText,
  Button,
  DisplayL,
  Foot,
  Loading,
  MessageBubble,
  Screen,
  Small,
  Tertiary,
  TopBar,
  useLoadingHold,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';
import { LoadFailed } from '../system/LoadFailed';

/**
 * AddSomeone — `docs/design/InviteCircle.dc.html`.
 *
 * What a member sends to put one more person into the circle between plans
 * (ADR 0091): the invitation as the chat will show it, **Share** and **Copy**.
 * Any active member can reach it; nothing here is about resetting, which is the
 * owner's and lives in settings. It is no step in the first run (ADR 0026): it
 * is reached from circle home, from settings, and from "Just invite people for
 * now" on the first plan.
 *
 * `expired` is an invitation that cannot be shown again — one made before it
 * could be (ADR 0028), or on a deployment without the key — and the way back to
 * one is the owner cancelling old invitations in the circle's settings.
 */
export type InviteCircleProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  circleName?: string | undefined;
  link?: string | undefined;
  message?: string | undefined;
  /** What the last tap did, said once: copied, or no way to copy here. */
  outcome?: 'copied' | 'couldnt_copy' | undefined;
  onRetry?: (() => void) | undefined;
  /** The screen's one decision: Share. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onCopy?: (() => void) | undefined;
  /** From the expired state: where the owner cancels old invitations. */
  onSettings?: (() => void) | undefined;
  /** From the expired state: back to the circle. */
  onHome?: (() => void) | undefined;
};

export function InviteCircleScreen({
  fixture,
  state = 'default',
  circleName = fixture?.circle.name ?? '',
  link = t('inviteCircle', 'domain_join_7f3k'),
  message = t('inviteCircle', 'join_on_brand', { circle: circleName }),
  outcome,
  onRetry,
  onNext,
  onBack,
  onCopy,
  onSettings,
  onHome,
}: InviteCircleProps) {
  const loading = useLoadingHold(state === 'loading');
  if (loading) {
    return (
      <Loading
        message={t('inviteCircle', 'loading')}
        shape="detail"
        onBack={onBack}
        onRetry={onRetry}
      />
    );
  }

  if (state === 'error' || state === 'offline') {
    return (
      <LoadFailed
        state={state}
        message={t('inviteCircle', state === 'offline' ? 'youre_offline' : 'couldnt_load')}
        where="circles"
        onBack={onBack}
        onRetry={onRetry}
      />
    );
  }

  if (state === 'expired') {
    return (
      <Screen>
        <TopBar onBack={onBack} backLabel={t('common', 'back')} />
        <Body>
          <Stack>
            <DisplayL>
              {t('inviteCircle', 'needs_a_new_invitation', { circle: circleName })}
            </DisplayL>
            <BodyText>
              {t(
                'inviteCircle',
                onSettings === undefined ? 'shown_once_member' : 'shown_once_owner',
              )}
            </BodyText>
          </Stack>
        </Body>
        <Foot>
          {onSettings === undefined ? null : (
            <Button label={t('inviteCircle', 'open_settings')} onPress={onSettings} />
          )}
          <Button
            label={t('inviteCircle', 'go_to_circle', { circle: circleName })}
            variant={onSettings === undefined ? 'primary' : 'secondary'}
            onPress={onHome}
          />
        </Foot>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar title={circleName} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <DisplayL>{t('inviteCircle', 'add_someone_to', { circle: circleName })}</DisplayL>
        <MessageBubble
          message={message}
          mark={[circleName, link]}
          to={t('inviteCircle', 'their_invitation')}
          caption={t('inviteCircle', 'theyre_in_as_soon')}
        />
        {outcome === undefined ? null : (
          <Small accessibilityLiveRegion="polite">
            {t('inviteCircle', outcome === 'copied' ? 'copied' : 'couldnt_copy')}
          </Small>
        )}
      </Body>
      <Foot>
        <Button label={t('inviteCircle', 'share')} onPress={onNext} />
        <Tertiary label={t('inviteCircle', 'copy')} onPress={onCopy} />
      </Foot>
    </Screen>
  );
}
