import { z } from 'zod';

// Compact shape shown in the workspace settings list — one row per
// subscription, without the full event-type array.
export const WebhookSubscriptionSummary = z.object({
  id: z.string(),
  url: z.string(),
  status: z.enum(['active', 'suspended']),
  consecutiveFailures: z.number(),
});
export type WebhookSubscriptionSummary = z.infer<typeof WebhookSubscriptionSummary>;
