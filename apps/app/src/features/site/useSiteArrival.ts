import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';

import { track } from '../../analytics/track';
import { keepArrivalTag } from '../../data/draft';
import { CAMPAIGN_PARAM, SITE_ARRIVAL_VALUE } from './sections';

/**
 * Records `site_start_plan_clicked` when `/start` opens from the site's
 * button (`?via=site`).
 *
 * It is the app that sends it, not the page, so the page needs no script and
 * no key, and the event goes through the same `track()` as every other one.
 * It carries nothing: no payload, and nothing in the URL beyond the one word
 * that says where the visitor came from. Once per mount, so a re-render never
 * counts twice.
 *
 * A link we post may also carry `?from=<tag>` (SUS-240), which the site hands on
 * to this address. The tag is kept on this device (`keepArrivalTag`, a slug or
 * nothing) until the organiser passes the gate, and is never in an event.
 */
export function useSiteArrival(): void {
  const params = useLocalSearchParams<{ via?: string; from?: string | string[] }>();
  const sent = useRef(false);
  const via = params.via;
  const from = params[CAMPAIGN_PARAM];

  useEffect(() => {
    void keepArrivalTag(from);
  }, [from]);

  useEffect(() => {
    if (sent.current || via !== SITE_ARRIVAL_VALUE) return;
    sent.current = true;
    track('site_start_plan_clicked', {});
  }, [via]);
}
