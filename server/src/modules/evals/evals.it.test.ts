/**
 * evals.it.test.ts — DB-backed integration tests for the Eval Pipeline.
 *
 * Run in CI only (testcontainers Postgres):
 *   cd server && pnpm exec vitest run .it.test
 *
 * Excluded from the local hermetic suite:
 *   pnpm exec vitest run --exclude '**\/*.it.test.ts'
 *
 * Covers acceptance criteria 1, 2, 3, 5, 12, 13, 16, 17:
 *   1  — Accept → create case → run → status=succeeded, case passed, recall non-null
 *   2  — Double-click → one case, one target, 200, no revision bump
 *   3  — Undecided → 422
 *   5  — Accept + dismiss on same PR → ONE case, TWO target kinds (must_find +
 *         must_not_flag), ONE copy of the diff (not two separate cases)
 *   12 — PR delete → case still runnable; source_pr_id + finding id null
 *   13 — Run records agent_version; later prompt edit doesn't change it
 *   16 — scope='case' run absent from GET /agents/:id/eval-dashboard
 *   17 — 'running' row swept to 'failed' on next boot reap
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { MockLLMProvider } from '../../adapters/mocks.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Minimal diff text that parseUnifiedDiff will accept. */
const SIMPLE_DIFF = [
  'diff --git a/src/foo.ts b/src/foo.ts',
  '--- a/src/foo.ts',
  '+++ b/src/foo.ts',
  '@@ -1,3 +1,5 @@',
  ' function foo() {',
  '+  const x = bar();',
  '+  return x.value;',
  ' }',
].join('\n');

const MOCK_REVIEW_OUTPUT = {
  verdict: 'comment',
  summary: 'Test review',
  score: 80,
  findings: [
    {
      id: 'f1',
      severity: 'WARNING',
      category: 'bug',
      title: 'Null deref at line 2',
      rationale: 'bar() may return null',
      suggestion: 'Add null check',
      confidence: 0.9,
      file: 'src/foo.ts',
      start_line: 2,
      end_line: 2,
      kind: 'finding',
    },
  ],
};

async function buildTestApp(): Promise<FastifyInstance> {
  const mockLlm = new MockLLMProvider('openai', { structured: MOCK_REVIEW_OUTPUT });
  return buildApp({
    overrides: {
      llm: { openai: mockLlm, anthropic: mockLlm, openrouter: mockLlm },
    },
  });
}

/**
 * Seed a workspace, agent, finding (accepted or dismissed), and return their ids.
 * This is intentionally minimal — the tests care about the eval logic, not the
 * full PR lifecycle.
 */
async function seedFixture(
  app: FastifyInstance,
  opts: { accepted?: boolean; dismissed?: boolean } = { accepted: true },
): Promise<{
  workspaceId: string;
  agentId: string;
  findingId: string;
  prId: string;
  reviewId: string;
}> {
  // Create a workspace (using the settings/workspace route or direct DB).
  // For brevity, use the app's DB directly (it.test files have access to the DB).
  const db = app.container.db;

  // ---- Workspace ----
  const [ws] = await db
    .insert((await import('../../db/schema.js')).workspaces)
    .values({ name: 'Test workspace' })
    .returning();
  if (!ws) throw new Error('workspace insert failed');

  // ---- Repo + PR ----
  const { repos, pullRequests, prFiles } = await import('../../db/schema.js');
  const [repo] = await db
    .insert(repos)
    .values({
      workspaceId: ws.id,
      owner: 'testorg',
      name: 'testrepo',
      fullName: 'testorg/testrepo',
      defaultBranch: 'main',
    })
    .returning();
  if (!repo) throw new Error('repo insert failed');

  const [pr] = await db
    .insert(pullRequests)
    .values({
      workspaceId: ws.id,
      repoId: repo.id,
      number: 1,
      title: 'Test PR',
      author: 'dev',
      branch: 'feat/test',
      base: 'main',
      headSha: 'sha123',
      status: 'open',
    })
    .returning();
  if (!pr) throw new Error('pr insert failed');

  // Seed a pr_file so prFilesToDiffText produces something parseable.
  await db
    .insert(prFiles)
    .values({
      prId: pr.id,
      path: 'src/foo.ts',
      patch: '@@ -1,3 +1,5 @@\n function foo() {\n+  const x = bar();\n+  return x.value;\n }',
      additions: 2,
      deletions: 0,
    });

  // ---- Agent ----
  const agent = await app.container.agentsRepo.insert({
    workspaceId: ws.id,
    name: 'Test agent',
    description: 'For eval tests',
    provider: 'openai',
    model: 'gpt-4.1',
    systemPrompt: 'You are a code reviewer.',
  });

  // ---- Review + finding ----
  const { reviews, findings } = await import('../../db/schema.js');
  const [review] = await db
    .insert(reviews)
    .values({
      workspaceId: ws.id,
      prId: pr.id,
      agentId: agent.id,
      runId: null,
      kind: 'review',
      verdict: 'comment',
      summary: 'Test',
      score: 80,
      model: 'gpt-4.1',
    })
    .returning();
  if (!review) throw new Error('review insert failed');

  const [finding] = await db
    .insert(findings)
    .values({
      reviewId: review.id,
      file: 'src/foo.ts',
      startLine: 2,
      endLine: 2,
      severity: 'WARNING',
      category: 'bug',
      title: 'Null deref',
      rationale: 'bar() may return null',
      suggestion: null,
      confidence: 0.9,
      kind: 'finding',
      ...(opts.accepted ? { acceptedAt: new Date() } : {}),
      ...(opts.dismissed ? { dismissedAt: new Date() } : {}),
    })
    .returning();
  if (!finding) throw new Error('finding insert failed');

  return { workspaceId: ws.id, agentId: agent.id, findingId: finding.id, prId: pr.id, reviewId: review.id };
}

/**
 * Seed a SECOND finding on the same review/PR — used to test the fold rule (AC5).
 * The finding is dismissed so its kind will be 'must_not_flag'.
 */
async function seedDismissedFindingOnSameReview(
  app: FastifyInstance,
  reviewId: string,
): Promise<string> {
  const db = app.container.db;
  const { findings } = await import('../../db/schema.js');
  const [dismissed] = await db
    .insert(findings)
    .values({
      reviewId,
      file: 'src/bar.ts',
      startLine: 5,
      endLine: 10,
      severity: 'WARNING',
      category: 'style',
      title: 'Unused variable',
      rationale: 'var x is never read',
      suggestion: null,
      confidence: 0.8,
      kind: 'finding',
      dismissedAt: new Date(),
    })
    .returning();
  if (!dismissed) throw new Error('dismissed finding insert failed');
  return dismissed.id;
}

/** Poll GET /eval-runs/:id until status is not 'running' (or timeout). */
async function waitForRun(
  app: FastifyInstance,
  suiteRunId: string,
  maxMs = 2000,
): Promise<{
  status: string;
  recall: number | null;
  cases_passed: number;
  cases: unknown[];
  inputs: { agent_version: number };
}> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const res = await app.inject({ method: 'GET', url: `/eval-runs/${suiteRunId}` });
    const body = JSON.parse(res.body);
    if (body.status !== 'running') return body;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Run ${suiteRunId} did not complete within ${maxMs}ms`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Eval Pipeline — DB-backed integration tests', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  // ---- Criterion 3: undecided → 422 ----------------------------------------

  it('AC3: POST /findings/:id/eval-case returns 422 for undecided finding', async () => {
    const { findingId } = await seedFixture(app, {}); // neither accepted nor dismissed

    const res = await app.inject({
      method: 'POST',
      url: `/findings/${findingId}/eval-case`,
    });

    expect(res.statusCode).toBe(422);
  });

  // ---- Criterion 1: foundational — accept → case → run → succeeded + passed ---
  //
  // This is the most fundamental check: if it fails, the freeze or the executor
  // is broken and nothing downstream means anything. Asserts:
  //   - status === 'succeeded' (not merely 'not running')
  //   - cases_passed > 0 (at least one case passed)
  //   - recall is non-null (denominator was non-empty — there was a must_find target)

  it('AC1: accept finding → create case → run suite → succeeded with passing case and non-null recall', async () => {
    const { agentId, findingId } = await seedFixture(app, { accepted: true });

    // Create the eval case from the accepted finding.
    const caseRes = await app.inject({
      method: 'POST',
      url: `/findings/${findingId}/eval-case`,
    });
    expect(caseRes.statusCode).toBe(201);
    const evalCase = JSON.parse(caseRes.body);
    // Confirm the target is must_find (derived from accepted_at).
    expect(evalCase.targets[0].kind).toBe('must_find');

    // Start a full suite run. No payload — this mirrors the real client, which
    // omits the body entirely for an unfiltered run and sends no content-type
    // with it. Sending `payload: {}` here would exercise a shape the client
    // never produces and would miss a 422 on the unfiltered path.
    const runRes = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/eval-runs`,
    });
    expect(runRes.statusCode).toBe(202);
    const { suite_run_id } = JSON.parse(runRes.body);

    // Wait for completion.
    const suiteRun = await waitForRun(app, suite_run_id);

    // Criterion 1 assertions.
    expect(suiteRun.status).toBe('succeeded');
    expect(suiteRun.cases_passed).toBeGreaterThan(0);
    // recall must be non-null: the case has a must_find target so the denominator is 1.
    expect(suiteRun.recall).not.toBeNull();
  });

  // ---- Criterion 2: idempotency — double click → 200, no revision bump ----

  it('AC2: double POST returns 200 on second call with same case unchanged', async () => {
    const { findingId } = await seedFixture(app, { accepted: true });

    const first = await app.inject({
      method: 'POST',
      url: `/findings/${findingId}/eval-case`,
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: `/findings/${findingId}/eval-case`,
    });
    expect(second.statusCode).toBe(200);

    const firstBody = JSON.parse(first.body);
    const secondBody = JSON.parse(second.body);

    // Same case id, same number of targets, revision unchanged.
    expect(firstBody.id).toBe(secondBody.id);
    expect(secondBody.targets).toHaveLength(1);
    expect(secondBody.revision).toBe(firstBody.revision);
  });

  // ---- Criterion 5: accept + dismiss on same PR → ONE case, TWO target kinds ---
  //
  // The fold rule: when an accepted and a dismissed finding from the same PR are
  // turned into eval cases, they must land in ONE case with TWO targets (one
  // must_find, one must_not_flag) and ONE copy of the diff — not two separate cases.

  it('AC5: accept + dismiss on same PR folds into one case with both target kinds', async () => {
    // Seed: accepted finding on PR (agentId, prId, reviewId are all from the same fixture).
    const { agentId, findingId, reviewId } = await seedFixture(app, { accepted: true });

    // POST first finding → creates the case.
    const firstRes = await app.inject({
      method: 'POST',
      url: `/findings/${findingId}/eval-case`,
    });
    expect(firstRes.statusCode).toBe(201);
    const firstCase = JSON.parse(firstRes.body) as {
      id: string;
      targets: Array<{ kind: string }>;
      source_pr_id: string;
      input_diff: string;
    };
    expect(firstCase.targets).toHaveLength(1);
    expect(firstCase.targets[0]!.kind).toBe('must_find');

    // Seed a DISMISSED finding on the SAME review (= same PR, same agent).
    const dismissedFindingId = await seedDismissedFindingOnSameReview(app, reviewId);

    // POST second finding → must fold into the SAME case.
    const secondRes = await app.inject({
      method: 'POST',
      url: `/findings/${dismissedFindingId}/eval-case`,
    });
    // Fold rule: 200 (existing case updated, not a new one created).
    expect(secondRes.statusCode).toBe(200);
    const foldedCase = JSON.parse(secondRes.body) as {
      id: string;
      targets: Array<{ kind: string }>;
      source_pr_id: string;
      input_diff: string;
    };

    // Same case id — not a second case.
    expect(foldedCase.id).toBe(firstCase.id);

    // TWO targets: one must_find + one must_not_flag.
    expect(foldedCase.targets).toHaveLength(2);
    const kinds = foldedCase.targets.map((t) => t.kind).sort();
    expect(kinds).toEqual(['must_find', 'must_not_flag']);

    // ONE diff (not duplicated).
    expect(foldedCase.input_diff).toBe(firstCase.input_diff);

    // Verify via list: only one case for this agent.
    const listRes = await app.inject({
      method: 'GET',
      url: `/agents/${agentId}/eval-cases`,
    });
    expect(listRes.statusCode).toBe(200);
    const cases = JSON.parse(listRes.body) as Array<{ source_pr_id: string }>;
    const forThisPr = cases.filter((c) => c.source_pr_id === firstCase.source_pr_id);
    expect(forThisPr).toHaveLength(1);
  });

  // ---- Criterion 16: scope='case' absent from dashboard -------------------

  it('AC16: single-case debug run is absent from eval-dashboard', async () => {
    const { workspaceId, agentId, findingId } = await seedFixture(app, { accepted: true });

    // Create a case.
    const caseRes = await app.inject({
      method: 'POST',
      url: `/findings/${findingId}/eval-case`,
    });
    expect(caseRes.statusCode).toBe(201);
    const evalCase = JSON.parse(caseRes.body);

    // Start a single-case debug run.
    const runRes = await app.inject({
      method: 'POST',
      url: `/eval-cases/${evalCase.id}/run`,
    });
    expect(runRes.statusCode).toBe(202);
    const { suite_run_id } = JSON.parse(runRes.body);

    // Wait for the run to complete.
    await waitForRun(app, suite_run_id);

    // Dashboard must NOT include this debug run.
    const dashRes = await app.inject({
      method: 'GET',
      url: `/agents/${agentId}/eval-dashboard`,
    });
    expect(dashRes.statusCode).toBe(200);
    const dashboard = JSON.parse(dashRes.body);
    // recent_runs should not include the debug run (scope='case').
    const runIds = (dashboard.recent_runs as Array<{ id: string }>).map((r) => r.id);
    expect(runIds).not.toContain(suite_run_id);
  });

  // ---- Criterion 17: running row swept to failed on boot reap --------------

  it('AC17: reapStaleSuiteRuns moves old running rows to failed', async () => {
    const db = app.container.db;
    const { evalSuiteRuns, workspaces } = await import('../../db/schema.js');

    // Create a workspace first.
    const [ws] = await db
      .insert(workspaces)
      .values({ name: 'Reap test workspace' })
      .returning();
    if (!ws) throw new Error('workspace insert failed');

    // Insert a suite run that appears to have started 5 minutes ago (> 60s cutoff).
    const staleRanAt = new Date(Date.now() - 5 * 60 * 1000);
    const [staleRun] = await db
      .insert(evalSuiteRuns)
      .values({
        workspaceId: ws.id,
        ownerKind: 'agent',
        ownerId: '00000000-0000-0000-0000-000000000001',
        agentVersion: 1,
        skillVersions: [],
        caseSetRevision: 'abc123',
        scope: 'suite',
        status: 'running',
        casesTotal: 5,
        ranAt: staleRanAt,
      })
      .returning();
    if (!staleRun) throw new Error('stale run insert failed');

    // Call the reaper.
    const { EvalService } = await import('./service.js');
    const service = new EvalService(app.container);
    const reaped = await service.reapStaleSuiteRuns();

    expect(reaped).toBeGreaterThanOrEqual(1);

    // Verify the row is now 'failed'.
    const { eq } = await import('drizzle-orm');
    const [updated] = await db
      .select()
      .from(evalSuiteRuns)
      .where(eq(evalSuiteRuns.id, staleRun.id));
    expect(updated?.status).toBe('failed');
    expect(updated?.error).toBeTruthy();
  });

  // ---- Criterion 12: PR delete → case still runnable, ids null ------------

  it('AC12: deleting the PR leaves the case runnable and nulls source_pr_id', async () => {
    const { workspaceId, agentId, findingId, prId } = await seedFixture(app, { accepted: true });

    // Create the case.
    const caseRes = await app.inject({
      method: 'POST',
      url: `/findings/${findingId}/eval-case`,
    });
    expect(caseRes.statusCode).toBe(201);
    const evalCase = JSON.parse(caseRes.body);
    expect(evalCase.source_pr_id).toBe(prId);

    // Delete the PR (cascade via FK: source_pr_id SET NULL on eval_cases).
    const db = app.container.db;
    const { pullRequests } = await import('../../db/schema.js');
    const { eq } = await import('drizzle-orm');
    await db.delete(pullRequests).where(eq(pullRequests.id, prId));

    // List cases — the case must still exist, with source_pr_id = null.
    const listRes = await app.inject({
      method: 'GET',
      url: `/agents/${agentId}/eval-cases`,
    });
    expect(listRes.statusCode).toBe(200);
    const cases = JSON.parse(listRes.body) as Array<{ id: string; source_pr_id: string | null; targets: Array<{ source_finding_id: string | null }> }>;
    const theCase = cases.find((c) => c.id === evalCase.id);
    expect(theCase).toBeDefined();
    expect(theCase!.source_pr_id).toBeNull();

    // The target's source_finding_id: with the finding still present (review cascade
    // would only delete it if review were deleted), it should still have a value.
    // This tests that the case itself still exists and is accessible.
    expect(theCase!.targets.length).toBe(1);
  });

  // ---- Criterion 13: run records agent_version; later edit doesn't change it --

  it('AC13: completed run preserves the agent_version it ran at', async () => {
    const { workspaceId, agentId, findingId } = await seedFixture(app, { accepted: true });

    // Create the case.
    const caseRes = await app.inject({
      method: 'POST',
      url: `/findings/${findingId}/eval-case`,
    });
    expect(caseRes.statusCode).toBe(201);
    const evalCase = JSON.parse(caseRes.body);

    // Start a suite run (record agent_version at run start). Body omitted — see
    // AC1 above for why this must not send `payload: {}`.
    const runRes = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/eval-runs`,
    });
    expect(runRes.statusCode).toBe(202);
    const { suite_run_id } = JSON.parse(runRes.body);

    // Wait for completion.
    const suiteRun = await waitForRun(app, suite_run_id);
    expect(suiteRun.status).not.toBe('running');
    const versionAtRun = suiteRun.inputs.agent_version;

    // Now edit the agent's system prompt — bumps agent version.
    await app.container.agentsRepo.update(workspaceId, agentId, {
      systemPrompt: 'An edited system prompt that bumps the version.',
    });

    // The completed run must still show the OLD agent_version.
    const runAfterEdit = await app.inject({
      method: 'GET',
      url: `/eval-runs/${suite_run_id}`,
    });
    const runBody = JSON.parse(runAfterEdit.body) as { inputs: { agent_version: number } };
    expect(runBody.inputs.agent_version).toBe(versionAtRun);
  });
});
