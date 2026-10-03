import { useCallback, useEffect, useState } from 'react';

import { track } from '../../analytics/track';
import { readDraft, saveDraft, type DraftPatch, type OrganiserDraft } from '../../data/draft';

/**
 * The first run's draft, as a screen sees it (ADR 00YY): read once on mount,
 * and written through on every change.
 *
 * `loaded` is false until the read has come back, so a screen does not decide
 * "there is no draft" on its first frame and send somebody away from the one
 * they came back to after a reload or an email code.
 *
 * `organiser_draft_started` is counted on the write that makes the draft — no
 * payload, nothing about the circle — so the funnel's first stage is people who
 * typed something, not people who opened a page.
 */
export function useOrganiserDraft(): {
  loaded: boolean;
  draft: OrganiserDraft | null;
  save: (patch: DraftPatch) => Promise<OrganiserDraft>;
} {
  const [state, setState] = useState<{ loaded: boolean; draft: OrganiserDraft | null }>({
    loaded: false,
    draft: null,
  });

  useEffect(() => {
    let current = true;
    void readDraft().then((draft) => {
      if (current) setState({ loaded: true, draft });
    });
    return () => {
      current = false;
    };
  }, []);

  const save = useCallback(async (patch: DraftPatch) => {
    const { draft, created } = await saveDraft(patch);
    setState({ loaded: true, draft });
    if (created) track('organiser_draft_started', {});
    return draft;
  }, []);

  return { ...state, save };
}
