import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AnnotationInput } from './shared.js';
import { annotations } from './db.js';
import { getContext } from '../_shared/context.js';
import { AnnotationService } from './service.js';

export default async function annotationsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new AnnotationService(app.container);

  app.post('/annotations', { schema: { body: AnnotationInput } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    await service.add(workspaceId, req.body.findingId, req.body.note);
    return { status: 'added' };
  });

  // Returns the most recent annotation per finding, so the activity feed
  // doesn't show duplicate entries when a finding was annotated more than
  // once.
  app.get('/annotations/recent', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const db = app.container.db;
    const rows = await db
      .select()
      .from(annotations)
      .where({ workspaceId })
      .orderBy('createdAt', 'desc');

    const seen = new Set<string>();
    const deduped = [];
    for (const row of rows) {
      if (seen.has(row.findingId)) continue;
      seen.add(row.findingId);
      deduped.push(row);
    }
    return deduped;
  });
}
