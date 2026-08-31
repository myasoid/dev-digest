import { z } from 'zod';

export const WebhookSubscription = z.object({
  id: z.string(),
  workspaceId: z.string(),
  url: z.string(),
  eventTypes: z.array(z.string()),
  consecutiveFailures: z.number(),
  status: z.enum(['active', 'suspended']),
});
export type WebhookSubscription = z.infer<typeof WebhookSubscription>;

export const WebhookSubscriptionInput = z.object({
  url: z.string(),
  eventTypes: z.array(z.string()),
});
export type WebhookSubscriptionInput = z.infer<typeof WebhookSubscriptionInput>;

export interface WebhookDelivery {
  id: string;
  subscriptionId: string;
  eventType: string;
  success: boolean;
  attemptedAt: Date;
}
