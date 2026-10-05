import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import type { CircleHome } from '../../data/circles';
import { showHomeAtOnce } from './optimisticHome';

const KEY = ['circle-home', 'c1', 'maya'];
const home = { color: 'clay', cadence: 'monthly', mine: { mutedQuietAsks: false } } as CircleHome;

describe('showing a settings change before the server answers', () => {
  it('puts back only the fields the refused change touched', () => {
    const client = new QueryClient();
    client.setQueryData(KEY, home);

    const colourBack = showHomeAtOnce(client, KEY, { color: 'sky' });
    showHomeAtOnce(client, KEY, { cadence: 'fortnightly' });
    // The colour save is refused after the rhythm one has landed.
    colourBack();

    expect(client.getQueryData<CircleHome>(KEY)).toMatchObject({
      color: 'clay',
      cadence: 'fortnightly',
    });
  });

  it('does nothing when there is no home cached', () => {
    const client = new QueryClient();
    expect(() => showHomeAtOnce(client, KEY, { color: 'sky' })()).not.toThrow();
    expect(client.getQueryData(KEY)).toBeUndefined();
  });
});
