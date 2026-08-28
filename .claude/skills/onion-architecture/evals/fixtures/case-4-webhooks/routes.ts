import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { WebhookSubscriptionInput } from './shared.js';
import { webhookDeliveries } from './db.js';
import { getContext } from '../_shared/context.js';
import { WebhookService } from './service.js';

export default async function webhooksRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new WebhookService(app.container);

  app.post('/webhooks', { schema: { body: WebhookSubscriptionInput } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.get('/webhooks', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  // Delivery success/failure counts for a subscription, shown as a small bar
  // chart on the subscription detail page.
  app.get('/webhooks/:id/deliveries/summary', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const db = app.container.db;
    const rows = await db
      .select()
      .from(webhookDeliveries)
      .where({ workspaceId, subscriptionId: req.params.id });

    let succeeded = 0;
    let failed = 0;
    for (const row of rows) {
      if (row.success) succeeded++;
      else failed++;
    }
    return { succeeded, failed, total: rows.length };
  });
}
