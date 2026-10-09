import { describe, expect, it, vi } from 'vitest';

/**
 * The scheduler is called every minute and most ticks have nothing to send. The
 * renderer drags in react-dom and prettier, so it must be loaded by the first
 * job that needs it and by nothing before that.
 */

const loaded = vi.hoisted(() => ({ renderer: 0 }));

vi.mock('../_shared/email/render.tsx', () => {
  loaded.renderer += 1;
  return { render: () => Promise.resolve({ subject: '', html: '', text: '' }) };
});

describe('the scheduler', () => {
  it('does not load the email renderer to import the sender, or to run an idle tick', async () => {
    const { send } = await import('./send.ts');

    const result = await send({} as never, [], 'req', () => false);

    expect(result).toEqual({ sent: 0, skipped: 0, failed: 0, retried: 0 });
    expect(loaded.renderer).toBe(0);
  });
});
