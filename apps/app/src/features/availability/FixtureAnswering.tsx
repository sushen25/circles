import { useLocalSearchParams } from 'expo-router';

import { answerable, othersFirst, othersPartial } from '../../data/fixtures';
import { useFixture } from '../../data/fixtures/useFixture';
import { Answering, type AvailabilityStep } from './Answering';

/**
 * The editor with no backend: Sunday Crew's plan from fixtures, so the gallery
 * and the export stay clickable. The reader is Alex, and the scenario says how
 * far the group has got (SUS-129, SUS-206):
 *
 * - `partial` (the default): Alex has not answered, which is the point of the
 *   scenario. The editor is the first-time landing, an empty grid with the four
 *   who have answered counted on the days.
 * - `complete`: everyone has answered, Alex included, so the editor opens on
 *   Alex's own answer.
 * - `empty`: nobody has, and there are no counts.
 *
 * `?view=` opens the answer block in each of its states (SUS-236), on the same
 * plan asking about the whole day, since Sunday Crew's evenings have no
 * choice to make: `block` (Evening on three days, the pills), `each` ("A time
 * for each day", Wednesday its own) and `sheet` (Wednesday's hours).
 */
const WHOLE_DAY = { ...answerable.plan, dailyStartMin: 9 * 60, dailyEndMin: 22 * 60 + 30 };

/** Three evenings, 5:30–10:30 pm; in `each` and `sheet` Wednesday is 6–9:30 pm instead. */
const EVENING = (day: number, from = '07:30', to = '12:30') => ({
  start: `2099-09-${day}T${from}:00Z`,
  end: `2099-09-${day}T${to}:00Z`,
});

type View = 'block' | 'each' | 'sheet';

export function FixtureAnswering({ code, step }: { code: string; step: AvailabilityStep }) {
  const fixture = useFixture();
  const { view } = useLocalSearchParams<{ view?: string }>();
  const shown: View | undefined =
    view === 'block' || view === 'each' || view === 'sheet' ? view : undefined;
  const answered = fixture.name === 'complete';
  const others =
    fixture.name === 'empty' ? othersFirst : { ...othersPartial, readerAnswered: answered };

  if (shown !== undefined) {
    return (
      <Answering
        code={code}
        step={step}
        plan={WHOLE_DAY}
        answer={{
          status: 'windows',
          windows: [
            EVENING(14),
            shown === 'block' ? EVENING(16) : EVENING(16, '08:00', '11:30'),
            EVENING(17),
          ],
          submittedAt: answerable.answer?.submittedAt ?? '2026-09-01T09:00:00Z',
        }}
        draft={undefined}
        changed={false}
        userId={undefined}
        onStale={() => undefined}
        fixtureOthers={others}
        opening={shown === 'block' ? undefined : shown}
      />
    );
  }

  return (
    <Answering
      code={code}
      step={step}
      plan={answerable.plan}
      answer={answered ? answerable.answer : null}
      draft={undefined}
      changed={false}
      userId={undefined}
      onStale={() => undefined}
      fixtureOthers={others}
    />
  );
}
