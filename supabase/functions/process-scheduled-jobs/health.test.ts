import { afterEach, describe, expect, it, vi } from 'vitest';

const sent = vi.hoisted(() => ({ messages: [] as { html: string; text: string }[] }));

vi.mock('../_shared/email/resend.ts', () => ({
  EmailSendError: class extends Error {},
  sendEmail: (message: { html: string; text: string }) => {
    sent.messages.push(message);
    return Promise.resolve({ providerMessageId: 'x', transport: 'capture' });
  },
}));

import { escapeHtml, reportHealth } from './health.ts';

const HOSTILE = '</pre><img src=x onerror=alert(1)>&"\'';

function service(summary: Record<string, unknown>) {
  return {
    rpc: (name: string) =>
      Promise.resolve({
        data: name === 'dispatch_health_due' ? true : name === 'dispatch_health' ? summary : null,
        error: null,
      }),
  } as never;
}

afterEach(() => {
  delete process.env['HEALTH_REPORT_TO'];
  sent.messages.length = 0;
});

describe('the daily health summary', () => {
  it('escapes the report before it goes inside <pre>', () => {
    expect(escapeHtml(HOSTILE)).toBe(
      '&lt;/pre&gt;&lt;img src=x onerror=alert(1)&gt;&amp;&quot;&#39;',
    );
  });

  it('sends HTML in which a value cannot close the <pre> or add markup, and plain text as it was', async () => {
    process.env['HEALTH_REPORT_TO'] = 'founder@example.com';
    await reportHealth(service({ client_error_top_route: HOSTILE, failed_jobs_24h: 2 }), 'req-1');

    expect(sent.messages).toHaveLength(1);
    const { html, text } = sent.messages[0]!;
    expect(html.startsWith('<pre>')).toBe(true);
    expect(html.endsWith('</pre>')).toBe(true);
    expect(html.slice(5, -6)).not.toMatch(/[<>]/);
    expect(html).not.toContain('<img');
    expect(html).toContain('failed_jobs_24h: 2');
    expect(text).toContain(HOSTILE);
  });
});
