import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { LabelInput } from './shared.js';
import { findings } from './db.js';
import { getContext } from '../_shared/context.js';
import { LabelService } from './service.js';

export default async function labelsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new LabelService(app.container);

  app.post('/labels', { schema: { body: LabelInput } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.post('/repos/:id/labels/import', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.importFromGitHub(workspaceId, req.body.owner, req.body.name);
  });

  // Counts of findings per severity for each label, used by the label chips
  // in the review detail view.
  app.get('/labels/:id/findings/summary', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const db = app.container.db;
    const rows = await db
      .select()
      .from(findings)
      .where({ workspaceId, labelId: req.params.id });

    const bySeverity: Record<string, number> = { low: 0, medium: 0, high: 0 };
    for (const row of rows) {
      bySeverity[row.severity] = (bySeverity[row.severity] ?? 0) + 1;
    }
    return bySeverity;
  });
}
