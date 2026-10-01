import { answerable, othersFirst, othersPartial } from '../../data/fixtures';
import { useFixture } from '../../data/fixtures/useFixture';
import { Answering, type AvailabilityStep } from './Answering';

/**
 * The editor with no backend: Sunday Crew's plan from fixtures, so the gallery
 * and the export stay clickable. What the others said follows the gallery's
 * scenario (SUS-129): five of six answered on `partial` and `complete`, and
 * nobody yet on `empty`, which is the first-to-answer state.
 */
export function FixtureAnswering({ code, step }: { code: string; step: AvailabilityStep }) {
  const fixture = useFixture();
  return (
    <Answering
      code={code}
      step={step}
      plan={answerable.plan}
      answer={answerable.answer}
      draft={undefined}
      changed={false}
      userId={undefined}
      onStale={() => undefined}
      fixtureOthers={fixture.name === 'empty' ? othersFirst : othersPartial}
    />
  );
}
