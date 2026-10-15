import type { ReactNode } from 'react';

import { LoadError } from '../../components';
import { t } from '../../copy';
import { useExits } from './exits';
import { useFailureReference } from './useFailureReference';

/**
 * Where a screen sends somebody who cannot get past its failure (SUS-200):
 *
 * - `circles` — a signed-in route. "Back to your circles".
 * - `start` — the circles list itself, or the welcome screen, where "your
 *   circles" is the thing that failed: "Go to the start".
 * - `guest` — a guest or plan-link route, where there is no account to go back
 *   to. "Reload this page" asks the same address again, and the line under it
 *   says what to do when that is not enough: open the link from the chat again.
 */
export type LoadFailedWhere = 'circles' | 'start' | 'guest';

export type LoadFailedProps = {
  /** `offline`: the request never reached the server, so there is no reference. */
  state: 'error' | 'offline';
  /** The screen's sentence for this state: its `couldnt_load` or `youre_offline`. */
  message: string;
  where: LoadFailedWhere;
  onRetry?: (() => void) | undefined;
  topTitle?: string | undefined;
  onBack?: (() => void) | undefined;
  top?: ReactNode;
  header?: ReactNode;
  /** A request id the failed call already carries (`FunctionError.reference`). */
  reference?: string | undefined;
};

export function LoadFailed({ state, message, where, reference, ...rest }: LoadFailedProps) {
  const exits = useExits();
  const shown = useFailureReference(state === 'error', reference);

  const exit =
    where === 'circles'
      ? { label: t('loadError', 'back_to_circles'), onPress: exits.circles }
      : where === 'start'
        ? { label: t('loadError', 'go_to_start'), onPress: exits.start }
        : { label: t('loadError', 'reload_page'), onPress: exits.reload };

  return (
    <LoadError
      message={message}
      reference={shown}
      exit={exit}
      hint={where === 'guest' ? t('loadError', 'open_link_again') : undefined}
      {...rest}
    />
  );
}
