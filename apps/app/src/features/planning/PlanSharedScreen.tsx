import { Body, Button, DisplayL, Foot, Screen, Small, TopBar } from '../../components';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import { ShareScreen } from '../sharing/ShareScreen';
import type { ScreenState } from '../state';

/**
 * PlanShared — `docs/design/PlanShared.dc.html` (spec §5.1, ADR 0026): the
 * plan's link, ready for the group chat, and then the organiser's own times.
 *
 * It is the first thing a new organiser shares, so it is the share screen
 * (`features/sharing`), with the plan's message in the bubble and the plan's
 * link in the card under it. The message is the domain's (`newPlanMessage`),
 * never composed here, and the link carries no secret (ADR 0022).
 */
export type PlanSharedProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  circleName?: string | undefined;
  message?: string | undefined;
  /** The plan's own link, shown and copied (ADR 0022). */
  link?: string | undefined;
  /**
   * The two lines a chat app draws under the message, which are the OG
   * preview's own (`ogTitle`, `ogDescription`, S1-21) rather than a second
   * description of the same card: an organiser who is shown one thing and
   * sends another has been misled by their own screen.
   */
  linkTitle?: string | undefined;
  linkSubtitle?: string | undefined;
  /** "Replies close Tue 15 Sep, 6 pm. We'll show you …". */
  closes?: string | undefined;
  outcome?: 'copied' | 'couldnt_copy' | undefined;
  /**
   * Asking again after an edit or "Change the time" (S1-26): not the first
   * run's step, and a title and intro that say why the link is going round
   * a second time.
   */
  again?: { title: string; intro: string } | undefined;
  onRetry?: (() => void) | undefined;
  /** The screen's one decision: the organiser's own times, for the plan just made. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onCopy?: (() => void) | undefined;
  onShare?: (() => void) | undefined;
};

export function PlanSharedScreen({
  state = 'default',
  circleName = t('planShared', 'sunday_crew'),
  message = t('planShared', 'when_can_sunday_crew_actually_catch_up'),
  link = t('planShared', 'plan_link_example'),
  linkTitle = t('planShared', 'sunday_crew_is_finding_a_time'),
  linkSubtitle = t('planShared', 'pick_the_times_youd_be_up_for'),
  closes = t('planShared', 'replies_close_tue_15_sep_6_pm'),
  outcome,
  again,
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
    <ShareScreen
      step={again === undefined ? t('planShared', 'step_2_of_2') : undefined}
      title={again?.title ?? t('planShared', 'ask_circle', { circle: circleName })}
      intro={again?.intro ?? t('planShared', 'one_link_in_the_chat')}
      message={message}
      linkTitle={linkTitle}
      linkSubtitle={linkSubtitle}
      link={link}
      privacy={closes}
      outcome={outcome}
      onCopy={onCopy}
      onShare={onShare}
      onwardLabel={t('planShared', 'add_my_times')}
      onOnward={onNext}
      onBack={onBack}
    />
  );
}
