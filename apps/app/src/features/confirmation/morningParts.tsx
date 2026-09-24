import { t } from '../../copy';
import { Placeholder } from '../scheduling/parts';
import type { MorningAfterWords } from './morningAfter';

/**
 * The states the two morning-after screens share (manifesto §7): loading,
 * error and offline as every flow has them; `denied` for somebody outside the
 * circle; `early` before the meetup has ended; `off` for an evening that is not
 * the plan any more. Each is one sentence, neutral, and a way on — "a plan that
 * fails names no one" (§3.5).
 */
export type MorningState = 'default' | 'loading' | 'error' | 'offline' | 'denied' | 'early' | 'off';

/** Whose words: the organiser's screen or a member's. The keys are the same. */
export type MorningScreen = 'outcome' | 'wasThere';

export function MorningPlaceholder({
  screen,
  state,
  words,
  onRetry,
  onToCircle,
  onBack,
}: {
  screen: MorningScreen;
  state: Exclude<MorningState, 'default'>;
  words?: MorningAfterWords | undefined;
  onRetry?: (() => void) | undefined;
  onToCircle?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
}) {
  const toCircle =
    onToCircle === undefined || words === undefined
      ? {}
      : {
          actionLabel: t(screen, 'back_to_circle', { circle: words.circle }),
          onAction: onToCircle,
        };

  switch (state) {
    case 'error':
    case 'offline':
      return (
        <Placeholder
          message={t(screen, state === 'offline' ? 'youre_offline' : 'couldnt_load')}
          actionLabel={t(screen, 'try_again')}
          onAction={onRetry}
          onBack={onBack}
        />
      );
    case 'denied':
      return (
        <Placeholder
          message={t(screen, 'denied_title')}
          detail={t(screen, 'denied_body')}
          onBack={onBack}
        />
      );
    case 'early':
      return (
        <Placeholder
          topTitle={words?.circle}
          message={t(screen, 'early_title', { day: words?.day ?? '' })}
          detail={t(screen, 'early_body')}
          onBack={onBack}
          {...toCircle}
        />
      );
    case 'off':
      return (
        <Placeholder
          topTitle={words?.circle}
          message={t(screen, 'off_title')}
          detail={t(screen, 'off_body')}
          onBack={onBack}
          {...toCircle}
        />
      );
    case 'loading':
      return <Placeholder message={t(screen, 'loading')} onBack={onBack} />;
  }
}
