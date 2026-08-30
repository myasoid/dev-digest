import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { RunEvent } from '@devdigest/shared';
import { EvalCase } from '../../vendor/shared/contracts/knowledge.js';
import {
  EvalCaseInput,
  EvalDashboard,
  EvalRunRecord,
  EvalSuiteRunDetail,
} from '../../vendor/shared/contracts/eval-ci.js';
import { EvalSuiteRun, EvalGlobalDashboard, EvalRunAllResult } from '../../vendor/shared/contracts/eval-run.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { EvalService } from './service.js';

/**
 * Evals module routes.
 *
 * Thirteen routes (12 from spec §Routes table + 1 workspace fan-out):
 *   POST   /findings/:id/eval-case           → 201 created / 200 idempotent / 422 undecided
 *   GET    /agents/:id/eval-cases            → EvalCase[]
 *   POST   /agents/:id/eval-cases            → EvalCase (manual create)
 *   PATCH  /eval-cases/:id                   → EvalCase (update; bumps revision on measurement change)
 *   DELETE /eval-cases/:id                   → { ok }
 *   POST   /eval-cases/:id/run              → 202 { suite_run_id } (single-case debug run)
 *   GET    /agents/:id/eval-runs            → EvalSuiteRun[] (history, scope='suite')
 *   POST   /agents/:id/eval-runs            → 202 { suite_run_id } (full-set run; rate-limited)
 *   GET    /eval-runs/:id                    → EvalSuiteRun
 *   GET    /eval-runs/:id/events             → SSE RunEvent stream (replay-buffer-first)
 *   GET    /agents/:id/eval-dashboard        → EvalDashboard (per-agent aggregate)
 *   GET    /eval/dashboard                   → EvalGlobalDashboard (all-agents index)
 *   POST   /eval/run-all                     → 202 EvalRunAllResult (workspace fan-out; Decision B)
 *
 * PATCH instead of PUT for /eval-cases/:id — partial update semantics align with
 * isMeasurementChange(existing, patch) and match the actual behaviour. Deviation
 * from the spec table (which says PUT), noted in the implementation report.
 *
 * No compare route — the compare view fetches GET /eval-runs/:id (twice) and
 * GET /agents/:id/versions/:version (twice) client-side. (Criterion 18.)
 */

const RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;

/** Body schema for manually creating an eval case. */
const CreateCaseBody = EvalCaseInput.omit({ owner_kind: true, owner_id: true });

/** Body schema for patching an eval case (all fields optional). */
const PatchCaseBody = z.object({
  name: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
  targets: z.array(z.any()).optional(),
  unlisted: z.enum(['ignore', 'forbid']).optional(),
  input_diff: z.string().optional(),
});

/** Body for starting a suite run (optional case filter). */
const StartSuiteRunBody = z.object({
  /** Optional subset of case ids to run. Omitted = run all cases for the agent. */
  case_ids: z.array(z.string().uuid()).optional(),
});

export default async function evalsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new EvalService(container);

  // -------------------------------------------------------------------------
  // POST /findings/:id/eval-case
  //   Create (or fold) an eval case from an accepted/dismissed finding.
  //   201 = created, 200 = idempotent hit, 422 = undecided finding.
  // -------------------------------------------------------------------------
  app.post(
    '/findings/:id/eval-case',
    {
      schema: {
        params: IdParams,
        response: { 200: EvalCase, 201: EvalCase },
      },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const { evalCase, created } = await service.createCaseFromFinding(
        workspaceId,
        req.params.id,
      );
      return reply.status(created ? 201 : 200).send(evalCase);
    },
  );

  // -------------------------------------------------------------------------
  // GET /agents/:id/eval-cases
  // -------------------------------------------------------------------------
  app.get(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, response: { 200: z.array(EvalCase) } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listCases(workspaceId, req.params.id);
    },
  );

  // -------------------------------------------------------------------------
  // POST /agents/:id/eval-cases  — manual case creation
  // -------------------------------------------------------------------------
  app.post(
    '/agents/:id/eval-cases',
    {
      schema: {
        params: IdParams,
        body: CreateCaseBody,
        response: { 201: EvalCase },
      },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const evalCase = await service.createCase(workspaceId, req.params.id, req.body);
      return reply.status(201).send(evalCase);
    },
  );

  // -------------------------------------------------------------------------
  // PATCH /eval-cases/:id
  // -------------------------------------------------------------------------
  app.patch(
    '/eval-cases/:id',
    {
      schema: {
        params: IdParams,
        body: PatchCaseBody,
        response: { 200: EvalCase },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.updateCase(workspaceId, req.params.id, {
        name: req.body.name,
        notes: req.body.notes,
        targets: req.body.targets,
        unlisted: req.body.unlisted,
        inputDiff: req.body.input_diff,
      });
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /eval-cases/:id
  // -------------------------------------------------------------------------
  app.delete(
    '/eval-cases/:id',
    {
      schema: {
        params: IdParams,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const ok = await service.deleteCase(workspaceId, req.params.id);
      if (!ok) throw new NotFoundError('Eval case not found');
      return { ok: true as const };
    },
  );

  // -------------------------------------------------------------------------
  // POST /eval-cases/:id/run  — single-case debug run (scope='case')
  //   Rate-limited — fans out to a paid model call.
  // -------------------------------------------------------------------------
  app.post(
    '/eval-cases/:id/run',
    {
      schema: {
        params: IdParams,
        response: { 202: z.object({ suite_run_id: z.string() }) },
      },
      config: { rateLimit: RATE_LIMIT },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      // Need the agent id for the case. Load the case to get owner_id.
      const c = await service.getCase(workspaceId, req.params.id);
      const result = await service.startCaseRun(workspaceId, c.owner_id, req.params.id);
      return reply.status(202).send(result);
    },
  );

  // -------------------------------------------------------------------------
  // GET /agents/:id/eval-runs  — history (scope='suite' filtered in repo)
  // -------------------------------------------------------------------------
  app.get(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams, response: { 200: z.array(EvalSuiteRun) } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listSuiteRuns(workspaceId, req.params.id);
    },
  );

  // -------------------------------------------------------------------------
  // POST /agents/:id/eval-runs  — full-set suite run
  //   Returns 202 { suite_run_id } and executes in background.
  //   Rate-limited — fans out to paid model calls.
  // -------------------------------------------------------------------------
  app.post(
    '/agents/:id/eval-runs',
    {
      schema: {
        params: IdParams,
        body: StartSuiteRunBody,
        response: { 202: z.object({ suite_run_id: z.string() }) },
      },
      config: { rateLimit: RATE_LIMIT },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.startSuiteRun(
        workspaceId,
        req.params.id,
        'suite',
        req.body.case_ids,
      );
      return reply.status(202).send(result);
    },
  );

  // -------------------------------------------------------------------------
  // GET /eval-runs/:id  — suite run detail + per-case rows
  //   Returns EvalSuiteRunDetail = EvalSuiteRun fields + cases: EvalRunRecord[]
  //   so Phase 3 can render the violations/missed/kept/dropped table per case.
  // -------------------------------------------------------------------------
  app.get(
    '/eval-runs/:id',
    { schema: { params: IdParams, response: { 200: EvalSuiteRunDetail } } },
    async (req) => {
      await getContext(container, req);
      return service.getSuiteRunDetail(req.params.id);
    },
  );

  // -------------------------------------------------------------------------
  // GET /eval-runs/:id/events  — SSE progress stream (replay-buffer-first)
  //   Mirrors reviews/routes.ts:49. No rate limit (one long-lived connection).
  // -------------------------------------------------------------------------
  app.get(
    '/eval-runs/:id/events',
    { schema: { params: IdParams }, config: { rateLimit: false } },
    async (req, reply) => {
      await getContext(container, req);
      const suiteRunId = req.params.id;

      reply.sse(
        (async function* () {
          const queue: RunEvent[] = [];
          let resolve: (() => void) | null = null;
          let done = false;

          const unsubscribe = container.runBus.subscribe(suiteRunId, (e) => {
            queue.push(e);
            resolve?.();
          });
          const offDone = container.runBus.onDone(suiteRunId, () => {
            done = true;
            resolve?.();
          });

          try {
            while (true) {
              if (queue.length === 0) {
                if (done) break;
                await new Promise<void>((r) => (resolve = r));
                resolve = null;
                continue;
              }
              const e = queue.shift();
              if (!e) break;
              yield {
                id: String(e.seq),
                event: e.kind,
                data: JSON.stringify(e),
              };
            }
          } finally {
            unsubscribe();
            offDone();
          }
        })(),
      );
    },
  );

  // -------------------------------------------------------------------------
  // GET /agents/:id/eval-dashboard  — per-agent aggregate
  // -------------------------------------------------------------------------
  app.get(
    '/agents/:id/eval-dashboard',
    { schema: { params: IdParams, response: { 200: EvalDashboard } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getDashboard(workspaceId, req.params.id);
    },
  );

  // -------------------------------------------------------------------------
  // GET /eval/dashboard  — all-agents index (scope='suite', criterion 16)
  //   One row per agent + cross-agent recent runs.
  // -------------------------------------------------------------------------
  app.get(
    '/eval/dashboard',
    { schema: { response: { 200: EvalGlobalDashboard } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getGlobalDashboard(workspaceId);
    },
  );

  // -------------------------------------------------------------------------
  // POST /eval/run-all  — fan-out: start suite run for every agent in the
  //   workspace that has at least one eval case. Returns 202 immediately;
  //   runs sequentially in the background (Decision B: sequential, not parallel,
  //   because startSuiteRun throws 429 when activeSuiteRuns >= MAX_CONCURRENT).
  //   This is the most expensive endpoint — stricter rate limit than the others.
  // -------------------------------------------------------------------------
  app.post(
    '/eval/run-all',
    {
      schema: {
        response: { 202: EvalRunAllResult },
      },
      config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.runAllAgents(workspaceId);
      return reply.status(202).send(result);
    },
  );
}
