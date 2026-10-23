import type { ReactNode } from 'react';

import {
  Body,
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
import type { ScreenState } from '../state';
import { LoadFailed } from '../system/LoadFailed';

/**
 * FirstShare — screen 5 of the first run (SUS-247, spec §5.1): the link, ready
 * for the group chat, with the organiser's own evenings already in it.
 *
 * "Ask {group}." and the same bubble as the first screen, now with the real
 * link; one line saying when replies close and that the organiser will be
 * emailed the best times (spec §5.8 does); a primary **Share to group chat**
 * and **Copy** under it. No intro, no link-preview block, no link row, and
 * **nothing animates on arrival**: the manifesto keeps its one moment of arrival
 * for the confirmation screen (§5.5).
 *
 * When the share sheet closes the screen is the **done state**: "Over to
 * {group}.", the one line, the source question as a quiet card (a node, so it
 * is the flow's), **Go to {group}** and **Share again**. **Add my times** is
 * there only when the organiser chose to answer later.
 */
export type FirstShareProps = {
  state?: ScreenState | undefined;
  circleName?: string | undefined;
  /** The message as the chat will show it, with its link. */
  message?: string | undefined;
  link?: string | undefined;
  /** "Replies close Sun 25 Oct, 6 pm. We'll email you the best times." */
  closes?: string | undefined;
  done?: boolean | undefined;
  outcome?: 'copied' | 'couldnt_copy' | undefined;
  /** The organiser has not answered their own plan: Add my times. */
  addMine?: boolean | undefined;
  /** The source question, under the done state's line. */
  source?: ReactNode;
  onRetry?: (() => void) | undefined;
  onShare?: (() => void) | undefined;
  onCopy?: (() => void) | undefined;
  onAddMine?: (() => void) | undefined;
  onShareAgain?: (() => void) | undefined;
  onHome?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function FirstShareScreen({
  state = 'default',
  circleName = t('planShared', 'sunday_crew'),
  message = '',
  link = '',
  closes = '',
  done = false,
  outcome,
  addMine = false,
  source,
  onRetry,
  onShare,
  onCopy,
  onAddMine,
  onShareAgain,
  onHome,
  onBack,
}: FirstShareProps) {
  const loading = useLoadingHold(state === 'loading');
  if (loading) {
    return (
      <Loading
        message={t('planShared', 'loading')}
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
        message={t('planShared', state === 'offline' ? 'youre_offline' : 'couldnt_load')}
        where="circles"
        onBack={onBack}
        onRetry={onRetry}
      />
    );
  }

  return (
    <Screen>
      <TopBar title={circleName} />
      <Body>
        <Stack gap={16}>
          <DisplayL>
            {done
              ? t('planShared', 'over_to_circle', { circle: circleName })
              : t('planShared', 'ask_circle', { circle: circleName })}
          </DisplayL>
          {done ? null : (
            <MessageBubble
              to={t('planShared', 'bubble_to', { circle: circleName })}
              message={message}
              mark={[circleName, link]}
            />
          )}
          <Small accessibilityLiveRegion="polite">
            {done ? t('planShared', 'well_email_you') : closes}
          </Small>
          {outcome === 'couldnt_copy' ? <Small>{t('share', 'couldnt_copy')}</Small> : null}
        </Stack>
        {done ? source : null}
      </Body>
      <Foot>
        {done ? (
          <>
            <Button
              label={t('planShared', 'go_to_circle', { circle: circleName })}
              onPress={onHome}
            />
            <Tertiary label={t('planShared', 'share_again')} onPress={onShareAgain} />
          </>
        ) : (
          <>
            <Button label={t('share', 'share_to_group_chat')} onPress={onShare} />
            {addMine ? (
              <Button
                label={t('planShared', 'add_my_times')}
                variant="secondary"
                onPress={onAddMine}
              />
            ) : null}
            <Tertiary
              crossfade
              label={outcome === 'copied' ? t('share', 'copied') : t('share', 'copy')}
              onPress={onCopy}
              accessibilityLiveRegion="polite"
            />
          </>
        )}
      </Foot>
    </Screen>
  );
}
