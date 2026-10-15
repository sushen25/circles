import { t } from '../../copy';
import { Loading } from '../../components';
import { Placeholder } from '../scheduling/parts';
import { LoadFailed, type LoadFailedWhere } from '../system/LoadFailed';

/**
 * The states both confirmed screens share (manifesto §7). Loading, error and
 * offline are the plain screen every flow uses; `denied` is somebody outside
 * the circle, `expired` a plan that is off — cancelled or expired, so nothing
 * is happening at the old time — and `past` a meetup whose time is over, whose
 * morning after is S1-29's.
 */
export type ConfirmedState =
  'default' | 'loading' | 'error' | 'offline' | 'denied' | 'expired' | 'past';

export function ConfirmedPlaceholder({
  state,
  title,
  where,
  onRetry,
  onBack,
}: {
  state: ConfirmedState;
  title?: string | undefined;
  /** The organiser's screen is a signed-in route; the guest's is a plan link. */
  where: LoadFailedWhere;
  onRetry?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
}) {
  if (state === 'error' || state === 'offline') {
    return (
      <LoadFailed
        state={state}
        message={t('confirmedOrg', state === 'offline' ? 'youre_offline' : 'couldnt_load')}
        where={where}
        topTitle={title}
        onBack={onBack}
        onRetry={onRetry}
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
  if (state === 'past') {
    return (
      <Placeholder
        topTitle={title}
        message={t('confirmedOrg', 'past_title')}
        detail={t('confirmedOrg', 'past_body')}
        onBack={onBack}
      />
    );
  }
  return (
    <Loading
      topTitle={title}
      message={t('confirmedOrg', 'loading')}
      shape="detail"
      onBack={onBack}
      onRetry={onRetry}
    />
  );
}
