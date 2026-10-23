import { ORGANISER_SOURCES, type OrganiserSource } from '@circles/contracts';
import { useEffect, useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { Card, Chip, Chips, Small, Tertiary, Title } from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import { useSession } from '../../data/auth';
import { useNudge } from '../growth/useNudge';

/**
 * "How did you hear about {brand}?" (SUS-171), asked after the share, as a quiet
 * card under "Over to {group}." (SUS-247, ADR 0084's amendment, ADR 0090). Not a
 * step: the share has happened, nothing waits on it, and it is skippable.
 *
 * "Once per account" is `record-nudge`'s `organiser_source` row, which says the
 * account was asked and holds no answer. The answer goes only to the analytics
 * event, with nothing else in it; the account's own row says only that the
 * question was answered, the same for every choice, so it cannot be asked again
 * on this device after a sign-out either. A server that cannot be asked, an
 * account that has been asked before and a device with no backend all read as
 * nothing to ask, and no card is drawn.
 *
 * An organiser who arrived on a tagged link (`?from=`, SUS-240) is not asked:
 * the post is the answer, recorded as `content` the first time the card could
 * have shown, and skipping the question counts as asking it. The tag itself went
 * to the circle's cohort row when the circle was made, and is not in this event;
 * the first run tells this card the arrival was tagged (`tagged`) and nothing
 * else about it.
 */
const WORDS = {
  friend_group: 'friend_group',
  reddit: 'reddit',
  meetup: 'meetup',
  other: 'other',
} as const;

export function SourceCard({ tagged, enabled }: { tagged: boolean; enabled: boolean }) {
  const session = useSession();
  const nudge = useNudge('organiser_source', { enabled });
  const [gone, setGone] = useState(false);
  const recorded = useRef(false);
  const ready = !session.isLoading && session.userId !== undefined;

  // Arrived on a tagged link: the post is the answer, and nobody is asked.
  useEffect(() => {
    if (recorded.current || !enabled || !ready || nudge.showing !== 'show' || !tagged) return;
    recorded.current = true;
    track('organiser_source', { source: 'content' });
    nudge.tap();
    // `nudge` is a new object each render; its two functions are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ready, nudge.showing, tagged]);

  if (!enabled || !ready || gone || tagged || nudge.showing !== 'show') return null;

  const choose = (source: OrganiserSource) => {
    track('organiser_source', { source });
    // Answered, as far as this session is concerned, whichever way: a chip and
    // Skip are recorded alike on the account, which says it was asked and
    // nothing about what it said. The event is the only place a source is.
    nudge.tap();
    setGone(true);
  };

  const answers = ORGANISER_SOURCES.filter(
    // `content` is recorded for a tagged link without asking (SUS-240), never offered.
    (source): source is keyof typeof WORDS => source !== 'skipped' && source !== 'content',
  );

  return (
    <Card gap={14} padding={16}>
      <Stack gap={4}>
        <Title>{t('organiserSource', 'heading')}</Title>
        <Small>{t('organiserSource', 'detail')}</Small>
      </Stack>
      <Chips>
        {answers.map((source) => (
          <Chip
            key={source}
            label={t('organiserSource', WORDS[source])}
            onPress={() => choose(source)}
          />
        ))}
      </Chips>
      <Tertiary
        tone="plain"
        label={t('organiserSource', 'skip')}
        onPress={() => choose('skipped')}
      />
    </Card>
  );
}
