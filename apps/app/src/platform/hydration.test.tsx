import { act } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { useHydrated } from './hydration';

/**
 * The hook the root layout renders the shell on (ADR 0040). Its whole job is
 * to say `false` in two places — the server, and the client *while hydrating*
 * — and `true` straight after, without anybody calling anything. Each of those
 * is proved here with React's own server and hydration paths, because a hook
 * that said `true` while hydrating would be exactly the #418 it exists to stop.
 */

function Probe({ renders }: { renders?: string[] }) {
  const said = useHydrated() ? 'client' : 'shell';
  renders?.push(said);
  return <p>{said}</p>;
}

describe('useHydrated', () => {
  it('is false on the server', () => {
    expect(renderToString(<Probe />)).toBe('<p>shell</p>');
  });

  it('hydrates as false, with no mismatch, then renders true by itself', async () => {
    const container = document.createElement('div');
    container.innerHTML = renderToString(<Probe />);
    const onRecoverableError = vi.fn();
    const renders: string[] = [];

    await act(async () => {
      hydrateRoot(container, <Probe renders={renders} />, { onRecoverableError });
    });

    // The hydrating render says shell, and React's own re-render says client.
    expect(renders).toEqual(['shell', 'client']);
    expect(onRecoverableError, 'no hydration mismatch').not.toHaveBeenCalled();
    expect(container.textContent).toBe('client');
  });
});
