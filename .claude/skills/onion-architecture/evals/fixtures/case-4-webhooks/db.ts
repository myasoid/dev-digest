// Minimal stand-in for server/src/db/{client,schema}.ts.
export interface Db {
  select(): any;
  insert(table: any): any;
  update(table: any): any;
}

export const webhookSubscriptions = {
  workspaceId: 'webhook_subscriptions.workspace_id',
  id: 'webhook_subscriptions.id',
  consecutiveFailures: 'webhook_subscriptions.consecutive_failures',
};

export const webhookDeliveries = {
  workspaceId: 'webhook_deliveries.workspace_id',
  subscriptionId: 'webhook_deliveries.subscription_id',
  success: 'webhook_deliveries.success',
};
