/**
 * Blast module — transport layer only.
 *
 * Declares the Zod params + response schema, resolves tenancy via getContext,
 * and delegates all business logic to BlastService. No Drizzle here.
 *
 * GET /pulls/:id/blast
 *   Returns a PrBlastMap: changed symbols → callers → impacted endpoints/crons,
 *   with a tri-state status (ok / partial / degraded) and staleness metadata.
 *   Never returns 500 for an unindexed repo — degraded is a valid 200.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PrBlastMap } from '@devdigest/shared';
import { IdParams } from '../_shared/schemas.js';
import { getContext } from '../_shared/context.js';
import { BlastService } from './service.js';

export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new BlastService(app.container);

  app.get(
    '/pulls/:id/blast',
    {
      schema: {
        params: IdParams,
        response: { 200: PrBlastMap },
      },
    },
    async (req): Promise<PrBlastMap> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getBlastMap(workspaceId, req.params.id);
    },
  );
}
