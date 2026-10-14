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
 */
export function FixtureAnswering({ code, step }: { code: string; step: AvailabilityStep }) {
  const fixture = useFixture();
  const answered = fixture.name === 'complete';
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
      fixtureOthers={
        fixture.name === 'empty' ? othersFirst : { ...othersPartial, readerAnswered: answered }
      }
    />
  );
}
