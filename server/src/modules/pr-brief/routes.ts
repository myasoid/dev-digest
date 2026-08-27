/**
 * PR Brief module — transport layer only (SPEC-cross-06).
 *
 * GET  /pulls/:id/brief          → cached brief or `null` (never generated).
 *                                   No LLM call (AC-1).
 * POST /pulls/:id/brief/refresh  → forces a fresh generation, persists it,
 *                                   returns it. Rate limited like
 *                                   `/pulls/:id/intent/refresh` (AC-5).
 *
 * Staleness stays client-side: the GET response carries its own `head_sha`
 * and the client compares it against the PR's current head.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PrBrief } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { loadDiff } from '../reviews/diff-loader.js';
import { PrBriefService } from './service.js';

export default async function prBriefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new PrBriefService(container);

  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams, response: { 200: PrBrief.nullable() } } },
    async (req): Promise<PrBrief | null> => {
      const { workspaceId } = await getContext(container, req);
      const { pr } = await service.resolvePrAndRepo(workspaceId, req.params.id);
      const cached = await service.getCached(pr.id);
      return cached ?? null;
    },
  );

  // Forces a FRESH generation, ignoring any cache — the only path that
  // regenerates once a PR has already been briefed. Rate limited like
  // /pulls/:id/intent/refresh: this is an AI-generation endpoint.
  app.post(
    '/pulls/:id/brief/refresh',
    {
      schema: { params: IdParams, response: { 200: PrBrief } },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req): Promise<PrBrief> => {
      const { workspaceId } = await getContext(container, req);
      const { pr, repo } = await service.resolvePrAndRepo(workspaceId, req.params.id);
      const diff = await loadDiff(container, container.reviewRepo, workspaceId, pr, repo);
      return service.generate(workspaceId, pr, repo, diff);
    },
  );
}
