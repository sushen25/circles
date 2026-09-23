import { t } from '../../copy';
import { Placeholder } from '../scheduling/parts';

/**
 * The states both confirmed screens share (manifesto §7). Loading, error and
 * offline are the plain screen every flow uses; `denied` is somebody outside
 * the circle, `expired` a plan that is off — cancelled or expired, so nothing
 * is happening at the old time — and `happened` a meetup that is over, whose
 * morning after is S1-29's.
 */
export type ConfirmedState =
  'default' | 'loading' | 'error' | 'offline' | 'denied' | 'expired' | 'happened';

export function ConfirmedPlaceholder({
  state,
  title,
  onRetry,
  onBack,
}: {
  state: ConfirmedState;
  title?: string | undefined;
  onRetry?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
}) {
  if (state === 'error' || state === 'offline') {
    return (
      <Placeholder
        topTitle={title}
        message={
          state === 'offline'
            ? t('confirmedOrg', 'youre_offline')
            : t('confirmedOrg', 'couldnt_load')
        }
        actionLabel={t('confirmedOrg', 'try_again')}
        onAction={onRetry}
        onBack={onBack}
      />
    );
  }
  if (state === 'denied') {
    return (
      <Placeholder
        topTitle={title}
        message={t('confirmedOrg', 'denied_title')}
        detail={t('confirmedOrg', 'denied_body')}
        onBack={onBack}
      />
    );
  }
  if (state === 'expired') {
    return (
      <Placeholder
        topTitle={title}
        message={t('confirmedOrg', 'over_title')}
        detail={t('confirmedOrg', 'over_body')}
        onBack={onBack}
      />
    );
  }
  if (state === 'happened') {
    return (
      <Placeholder
        topTitle={title}
        message={t('confirmedOrg', 'happened_title')}
        detail={t('confirmedOrg', 'happened_body')}
        onBack={onBack}
      />
    );
  }
  return <Placeholder topTitle={title} message={t('confirmedOrg', 'loading')} onBack={onBack} />;
}
