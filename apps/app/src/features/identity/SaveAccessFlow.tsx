import type { ShortCode } from '@circles/contracts';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { track } from '../../analytics/track';
import { useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { noteSavedWith } from '../../data/auth/saved';
import { planToAnswer } from '../../data/availability';
import { answerable } from '../../data/fixtures';
import { SaveAccessScreen } from './SaveAccessScreen';
import { SavePlaceByEmail } from './SavePlaceByEmail';

/**
 * `/j/:code/save-access` — keep your place on every device (spec §5.1, §5.11).
 *
 * An email code, then `savePlace` (`SavePlaceByEmail`), which turns this guest
 * into an account (or, when the address already has one, signs into it) and
 * reconciles memberships through `claim-identity`. The moment is
 * `after_answer`: that is where this is offered. On success the person goes
 * back where they came from and that screen says so, once.
 */

export function SaveAccessFlow({ code }: { code: string }) {
  const router = useRouter();
  const session = useSession();
  const live = hasBackend();
  const question = useQuery({
    queryKey: ['plan-to-answer', code, session.userId],
    queryFn: () => planToAnswer(code as ShortCode),
    enabled: live && session.userId !== undefined,
    staleTime: 30_000,
  });
  const circleName = live ? question.data?.plan.circleName : answerable.plan.circleName;

  // Read once: a successful save turns this session into a saved one, and the
  // screen should not flip to "already saved" underneath the person.
  const [alreadySaved] = useState(() => session.status === 'saved' || session.status === 'app');

  const back = () =>
    router.canGoBack()
      ? router.back()
      : router.replace({ pathname: '/j/[code]/sent', params: { code } });

  if (alreadySaved && live) {
    return <SaveAccessScreen state="already_saved" circleName={circleName} onBack={back} />;
  }

  return (
    <SavePlaceByEmail
      moment="after_answer"
      circleName={circleName}
      onSaved={(address) => {
        track('account_claimed', { moment: 'after_answer' });
        noteSavedWith(code, address);
        back();
      }}
      onNotNow={back}
      onBack={back}
    />
  );
}
