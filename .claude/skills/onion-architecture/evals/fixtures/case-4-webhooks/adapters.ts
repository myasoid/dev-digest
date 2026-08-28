// Stand-in for server/src/adapters/notifications/*.
export interface NotificationClient {
  notifyOwnerOfSuspension(workspaceId: string, subscriptionUrl: string): Promise<void>;
}

export class SlackNotifier implements NotificationClient {
  constructor(private webhookUrl: string) {}

  async notifyOwnerOfSuspension(workspaceId: string, subscriptionUrl: string): Promise<void> {
    await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `Webhook subscription ${subscriptionUrl} in workspace ${workspaceId} was suspended after repeated failures.`,
      }),
    });
  }
}
