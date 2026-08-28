import type { Db } from '../db.js';
import { webhookSubscriptions } from '../db.js';

export interface SubscriptionRow {
  id: string;
  workspaceId: string;
  url: string;
  eventTypes: string[];
  consecutiveFailures: number;
  status: 'active' | 'suspended';
}

const SUSPEND_AFTER_FAILURES = 5;

/**
 * Returns every webhook subscription for a workspace, along with its current
 * status, so the settings page can show which ones need attention.
 */
export async function listSubscriptions(db: Db, workspaceId: string): Promise<SubscriptionRow[]> {
  const rows = await db
    .select()
    .from(webhookSubscriptions)
    .where({ workspaceId });

  return rows.map((row: any) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    url: row.url,
    eventTypes: row.eventTypes,
    consecutiveFailures: row.consecutiveFailures,
    status: row.consecutiveFailures >= SUSPEND_AFTER_FAILURES ? 'suspended' : 'active',
  }));
}

export async function incrementFailureCount(db: Db, subscriptionId: string): Promise<number> {
  const [row] = await db
    .update(webhookSubscriptions)
    .set({ consecutiveFailures: 'consecutive_failures + 1' })
    .where({ id: subscriptionId })
    .returning();
  return row.consecutiveFailures;
}

export async function resetFailureCount(db: Db, subscriptionId: string): Promise<void> {
  await db.update(webhookSubscriptions).set({ consecutiveFailures: 0 }).where({ id: subscriptionId });
}
