import { act } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { useHydrated } from './hydration';

/**
 * The hook the root layout renders the shell on (ADR 00XX). Its whole job is
 * to say `false` in two places — the server, and the client *while hydrating*
 * — and `true` straight after, without anybody calling anything. Each of those
 * is proved here with React's own server and hydration paths, because a hook
 * that said `true` while hydrating would be exactly the #418 it exists to stop.
 */

function Probe() {
  return <p>{useHydrated() ? 'client' : 'shell'}</p>;
}

describe('useHydrated', () => {
  it('is false on the server', () => {
    expect(renderToString(<Probe />)).toBe('<p>shell</p>');
  });

  it('hydrates as false, with no mismatch, then renders true by itself', async () => {
    const container = document.createElement('div');
    container.innerHTML = renderToString(<Probe />);
    const onRecoverableError = vi.fn();
    const seenWhileHydrating = container.textContent;

    await act(async () => {
      hydrateRoot(container, <Probe />, { onRecoverableError });
    });

    expect(seenWhileHydrating).toBe('shell');
    expect(onRecoverableError, 'no hydration mismatch').not.toHaveBeenCalled();
    expect(container.textContent).toBe('client');
  });
});
