import type { Container } from './container.js';
import { SlackNotifier } from './adapters.js';
import { WebhookRepository } from './repository.js';

/**
 * Webhooks service. Business logic for the Webhooks feature: listing
 * subscriptions, recording delivery attempts, and suspending subscriptions
 * that keep failing.
 */
export class WebhookService {
  private repo: WebhookRepository;

  constructor(private container: Container) {
    this.repo = new WebhookRepository(container.db);
  }

  async list(workspaceId: string) {
    return this.repo.listSubscriptions(workspaceId);
  }

  /** Record a delivery attempt, and suspend + notify the owner after too many failures in a row. */
  async recordAttempt(workspaceId: string, subscriptionId: string, eventType: string, success: boolean, subscriptionUrl: string) {
    await this.repo.recordDelivery({ subscriptionId, eventType, success });

    if (success) {
      await this.repo.resetFailureCount(subscriptionId);
      return;
    }

    const failures = await this.repo.incrementFailureCount(subscriptionId);
    if (failures >= 5) {
      const slackWebhookUrl = await this.container.secrets.get('SLACK_ALERTS_WEBHOOK_URL');
      const notifier = new SlackNotifier(slackWebhookUrl ?? '');
      await notifier.notifyOwnerOfSuspension(workspaceId, subscriptionUrl);
    }
  }
}
