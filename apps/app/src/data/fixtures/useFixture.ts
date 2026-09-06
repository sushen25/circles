import { useLocalSearchParams } from 'expo-router';

import { type Fixture, fixtureByName } from './index';

/**
 * Which scenario a screen is showing.
 *
 * `?fixture=empty` on web; on native the dev gallery passes it as a route
 * param. Slice 1 replaces this hook with TanStack Query against Supabase, and
 * the screens above it do not change.
 */
export function useFixture(): Fixture {
  const params = useLocalSearchParams<{ fixture?: string }>();
  return fixtureByName(params.fixture);
}
