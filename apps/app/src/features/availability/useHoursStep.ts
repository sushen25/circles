import {
  useFocusEffect,
  useIsFocused,
  useLocalSearchParams,
  usePathname,
  useRouter,
} from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import type { EditorState } from './editor';
import {
  HOURS_STEP,
  hoursStepShown,
  rememberHoursStepPushed,
  shareAnswer,
  sharedFor,
  type SharedAnswer,
} from './hoursStep';

/**
 * The address half of "A time for each day" (SUS-209, `hoursStep.ts`): whether
 * this editor is the step's, whether it is in front, and the ways in and out.
 */
export function useHoursStep(code: string, handoff: string) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useLocalSearchParams<Record<string, string>>();
  const stepParam = params.step;
  const otherParams = Object.fromEntries(
    Object.entries(params).filter(([key]) => key !== 'code' && key !== 'step'),
  );
  const exact = hoursStepShown(stepParam, code);
  // The screen under the step stays mounted, with the answer, and is not drawn:
  // two editors on one page would be two of every button to a screen reader.
  const focused = useIsFocused();
  // What the first screen had when this one opened; read once, at the start.
  const [handed] = useState((): SharedAnswer | undefined =>
    exact ? sharedFor(handoff) : undefined,
  );

  // A reload (or a pasted address) on `?step=hours` shows the first screen, and
  // the address says so.
  const staleStep = !exact && stepParam === HOURS_STEP;
  useEffect(() => {
    if (staleStep) router.setParams({ step: undefined });
  }, [staleStep, router]);

  return {
    exact,
    focused,
    handed,
    open: (state: EditorState, touched: boolean) => {
      shareAnswer({ key: handoff, state, touched, by: 'first' });
      rememberHoursStepPushed(code);
      router.push({
        pathname,
        params: { ...otherParams, step: HOURS_STEP },
      } as Parameters<typeof router.push>[0]);
    },
    close: () => {
      if (!exact) return;
      if (router.canGoBack()) router.back();
      else
        router.replace({ pathname, params: otherParams } as Parameters<typeof router.replace>[0]);
    },
  };
}

/**
 * The answer, handed between the two editors: the step writes every change, the
 * first screen takes it back when it is in front again, and writes its own so
 * that a Forward opens the step on what it has now.
 */
export function useHoursHandoff({
  exact,
  handoff,
  state,
  touched,
  restore,
}: {
  exact: boolean;
  handoff: string;
  state: EditorState;
  touched: boolean;
  restore: (answer: SharedAnswer) => void;
}) {
  useEffect(() => {
    shareAnswer({ key: handoff, state, touched, by: exact ? 'hours' : 'first' });
  }, [exact, handoff, state, touched]);
  useFocusEffect(
    useCallback(() => {
      if (exact) return;
      const handed = sharedFor(handoff);
      if (handed?.by !== 'hours') return;
      shareAnswer({ ...handed, by: 'first' });
      restore(handed);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [exact, handoff]),
  );
}
