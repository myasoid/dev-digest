import type { Db } from '../db.js';
import { webhookDeliveries } from '../db.js';

export interface RecordDeliveryParams {
  subscriptionId: string;
  eventType: string;
  success: boolean;
}

export async function recordDelivery(db: Db, params: RecordDeliveryParams): Promise<void> {
  await db.insert(webhookDeliveries).values({
    subscriptionId: params.subscriptionId,
    eventType: params.eventType,
    success: params.success,
    attemptedAt: new Date(),
  });
}

export async function listRecent(db: Db, subscriptionId: string) {
  return db.select().from(webhookDeliveries).where({ subscriptionId });
}
