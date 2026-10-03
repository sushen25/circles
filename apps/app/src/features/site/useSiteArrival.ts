import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';

import { track } from '../../analytics/track';
import { SITE_ARRIVAL_VALUE } from './sections';

/**
 * Records `site_start_plan_clicked` when `/start` opens from the site's
 * button (`?via=site`).
 *
 * It is the app that sends it, not the page, so the page needs no script and
 * no key, and the event goes through the same `track()` as every other one.
 * It carries nothing: no payload, and nothing in the URL beyond the one word
 * that says where the visitor came from. Once per mount, so a re-render never
 * counts twice.
 */
export function useSiteArrival(): void {
  const params = useLocalSearchParams<{ via?: string }>();
  const sent = useRef(false);
  const via = params.via;

  useEffect(() => {
    if (sent.current || via !== SITE_ARRIVAL_VALUE) return;
    sent.current = true;
    track('site_start_plan_clicked', {});
  }, [via]);
}
