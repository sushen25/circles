import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';

import { Button, Card, Label, Tertiary, Title } from '../../components';
import { t } from '../../copy';
import type { CircleHome } from '../../data/circles';
import { setAttendanceDismissed } from '../../data/confirmation';
import { dateOf, weekdayOf } from '../scheduling/words';

/**
 * Circle home's morning-after card (spec §5.10, S1-29).
 *
 * The organiser sees "Did Thursday's catch-up happen?" until they answer —
 * there is no "Not now", because the answer is what moves "Last caught up".
 * A member sees "Did you make it to Thursday's catch-up?" once: until they
 * answer, or say "Not now", which this device remembers. Whether either is
 * owed is the read's answer (`morningAfterOf`), not this card's.
 *
 * A secondary button, not the screen's primary: the home's one decision is
 * still planning the next one (manifesto §3.6).
 */
export function MorningAfterCard({
  label,
  title,
  onAnswer,
  onNotNow,
}: {
  label: string;
  title: string;
  onAnswer: () => void;
  onNotNow?: (() => void) | undefined;
}) {
  return (
    <Card>
      <Label>{label}</Label>
      <Title>{title}</Title>
      <Button label={t('outcome', 'prompt_answer')} variant="secondary" onPress={onAnswer} />
      {onNotNow === undefined ? null : (
        <Tertiary label={t('wasThere', 'not_now')} onPress={onNotNow} />
      )}
    </Card>
  );
}

/** The card for this home and reader, or nothing when nothing is owed. */
export function useMorningAfterCard(home: CircleHome): ReactNode {
  const router = useRouter();
  const client = useQueryClient();
  const owed = home.morningAfter;
  if (owed === null || home.status === 'archived') return null;

  const label = dateOf(owed.startsAt, home.zone);
  const day = weekdayOf(owed.startsAt, home.zone);

  if (owed.ask === 'outcome') {
    return (
      <MorningAfterCard
        label={label}
        title={t('outcome', 'title', { day })}
        onAnswer={() =>
          router.push({
            pathname: '/circles/[id]/plan/[planId]/outcome',
            params: { id: home.id, planId: owed.planId },
          })
        }
      />
    );
  }

  const me = home.me;
  return (
    <MorningAfterCard
      label={label}
      title={t('wasThere', 'title', { day })}
      onAnswer={() =>
        router.push({ pathname: '/p/[code]/attendance', params: { code: owed.code } })
      }
      onNotNow={
        me === undefined
          ? undefined
          : () => {
              void setAttendanceDismissed(me, owed.confirmationId).then(() =>
                client.invalidateQueries({ queryKey: ['circle-home', home.id] }),
              );
            }
      }
    />
  );
}
