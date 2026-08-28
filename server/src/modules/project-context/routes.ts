import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ContextDocPath, SetContextDocsBody } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ProjectContextService } from './service.js';

/**
 * Project Context module — repo-scoped document discovery/read and
 * workspace-scoped agent/skill attachment. See specs/2026-08-25-project-context.md.
 *
 *   GET  /repos/:id/context           → SpecFileList  (metadata only; { files, truncated, shown })
 *   GET  /repos/:id/context/doc       → SpecFile    (?path=, content non-null)
 *   POST /repos/:id/context/reindex   → IndexStatus
 *   GET  /agents/:id/context-docs     → ContextDocLink[]
 *   POST /agents/:id/context-docs     → ContextDocLink[]  (set-and-reorder)
 *   GET  /skills/:id/context-docs     → ContextDocLink[]
 *   POST /skills/:id/context-docs     → ContextDocLink[]  (set-and-reorder)
 *
 * `nothing else` in the handlers below (`onion-architecture` §Checklist 4):
 * parse via Zod, call the service, map the result to a status.
 */

/** `?path=` on the single-document read — the SAME bounded/traversal-refined
 *  schema the attach body uses, so both entry points share one gate (AC-4). */
const DocQuery = z.object({ path: ContextDocPath });

export default async function projectContextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ProjectContextService(app.container);

  app.get('/repos/:id/context', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.params.id);
  });

  app.get(
    '/repos/:id/context/doc',
    { schema: { params: IdParams, querystring: DocQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.doc(workspaceId, req.params.id, req.query.path);
    },
  );

  app.post('/repos/:id/context/reindex', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.reindex(workspaceId, req.params.id);
  });

  app.get('/agents/:id/context-docs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const links = await service.linksFor(workspaceId, 'agent', req.params.id);
    if (!links) throw new NotFoundError('Agent not found');
    return links;
  });

  app.post(
    '/agents/:id/context-docs',
    { schema: { params: IdParams, body: SetContextDocsBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const links = await service.setLinks(workspaceId, 'agent', req.params.id, req.body.paths);
      if (!links) throw new NotFoundError('Agent not found');
      return links;
    },
  );

  app.get('/skills/:id/context-docs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const links = await service.linksFor(workspaceId, 'skill', req.params.id);
    if (!links) throw new NotFoundError('Skill not found');
    return links;
  });

  app.post(
    '/skills/:id/context-docs',
    { schema: { params: IdParams, body: SetContextDocsBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const links = await service.setLinks(workspaceId, 'skill', req.params.id, req.body.paths);
      if (!links) throw new NotFoundError('Skill not found');
      return links;
    },
  );
}
