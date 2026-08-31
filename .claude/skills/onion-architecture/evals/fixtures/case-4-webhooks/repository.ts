import type { Db } from './db.js';
import { listSubscriptions, incrementFailureCount, resetFailureCount } from './repository/subscription.repo.js';
import { recordDelivery, listRecent } from './repository/delivery.repo.js';

/**
 * Webhooks data-access facade. Wraps the split-out repository/*.repo.ts
 * files for the module's Drizzle queries.
 */
export class WebhookRepository {
  constructor(private db: Db) {}

  listSubscriptions(workspaceId: string) {
    return listSubscriptions(this.db, workspaceId);
  }

  incrementFailureCount(subscriptionId: string) {
    return incrementFailureCount(this.db, subscriptionId);
  }

  resetFailureCount(subscriptionId: string) {
    return resetFailureCount(this.db, subscriptionId);
  }

  recordDelivery(params: { subscriptionId: string; eventType: string; success: boolean }) {
    return recordDelivery(this.db, params);
  }

  listRecentDeliveries(subscriptionId: string) {
    return listRecent(this.db, subscriptionId);
  }
}
