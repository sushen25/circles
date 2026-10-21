import { brand } from '@circles/config';
import { ExportMyDataRequest, type ExportMyDataResponse } from '@circles/contracts';

import { jsonHandler } from '../_shared/http.ts';

/**
 * The caller's own data, as JSON, to download (spec §13; S4-05, ADR 0083).
 *
 * `public.export_my_data` builds the document as the caller and is the whole
 * of what is decided: only rows keyed on their own id, nobody else's name, id
 * or address, the address as a hint. It takes the one-a-day rate token itself,
 * so calling it over RPC directly is no way round the limit; a second call the
 * same day is `too_many_requests`.
 *
 * No idempotency key, on purpose: the kit records an answer against its key
 * for seven days, and this answer is the person's data. Nothing is kept here
 * and nothing in the document is logged: the log line is the kit's fixed
 * fields, which hold no body.
 */
Deno.serve(
  jsonHandler({
    name: 'export-my-data',
    schema: ExportMyDataRequest,
    handle: async ({ caller }): Promise<ExportMyDataResponse> => {
      const { data, error } = await caller.rpc('export_my_data');
      if (error !== null) throw error;

      const day = new Date().toISOString().slice(0, 10);
      return {
        ok: true,
        filename: `${brand.name.toLowerCase()}-my-data-${day}.json`,
        data: data as Record<string, unknown>,
      };
    },
  }),
);
