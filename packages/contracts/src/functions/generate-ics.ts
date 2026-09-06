import { z } from 'zod';

import { PlanId } from '../ids.js';

/** `generate-ics` — A standards-compliant calendar file for a confirmation. Carries no tokens. */
export const GenerateIcsRequest = z.object({ plan_id: PlanId });
export type GenerateIcsRequest = z.infer<typeof GenerateIcsRequest>;

export const GenerateIcsResponse = z.object({
  filename: z.string(),
  content_type: z.literal('text/calendar'),
  body: z.string(),
});
export type GenerateIcsResponse = z.infer<typeof GenerateIcsResponse>;
