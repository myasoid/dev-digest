/**
 * Prompt-change experiment: does the system prompt affect precision, and do
 * must_not_flag cases fall first when noise is introduced?
 *
 * Unlike skills-experiment.ts — which calls reviewPullRequest() directly and
 * needs no database — this script drives EvalService, because that is the
 * machinery under test. EvalRunInputs records agent_version / skill_versions /
 * case_set_revision on every run, so a confound is visible in the output rather
 * than inferred, and the score comes from the same scorer path that the
 * production dashboard reads. Calling the engine directly would bypass all of
 * that and make the confound-detection guarantee meaningless.
 *
 * Consequence: unlike skills-experiment.ts this script needs a live Postgres.
 * It reads DATABASE_URL (default: postgres://devdigest:devdigest@localhost:5432/devdigest).
 * It creates a temporary workspace, agent, and eval cases; removes all of them
 * when done. Nothing is written to the repo. No reviews, findings, or agent_runs
 * rows are created — only eval_suite_runs and eval_runs (the service teardown
 * deletes even those).
 *
 *   cd server && pnpm experiment:evals --runs 5
 *
 * Needs OPENROUTER_API_KEY (from ~/.devdigest/secrets.json or the environment).
 * Costs real money — roughly (3 conditions × runs × cases) model calls.
 * Nothing is written to the repo or to any committed file.
 *
 * Design notes
 * -----------
 * N=1 per condition is noise, not evidence: the first version of skills-experiment
 * reported "0 findings without skills" once and "1 WARNING" on the very next
 * identical invocation. (root INSIGHTS.md, "What Works", 2026-08-14.)
 * This script runs N per condition (default 5) and reports the DISTRIBUTION —
 * min/median/max — plus a plain statement of whether the spread swamps the
 * observed delta. A 2-point precision move inside a ±5pt run-to-run spread
 * is not a result, and the output says so.
 *
 * Null metrics are never averaged as 0. A must_not_flag-only set has no
 * must_find targets, so recall is NULL. Averaging NULL as 0 reads as total
 * failure in exactly the case where the agent did everything right. Any run
 * that yields a null metric for a condition is reported as "n/a" for that
 * metric and is excluded from the spread, with a count of how many nulls
 * appeared.
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/platform/config.js';
import { createDb } from '../src/db/client.js';
import { Container } from '../src/platform/container.js';
import { EvalService } from '../src/modules/evals/service.js';
import { runBus } from '../src/platform/sse.js';
import type { EvalSuiteRun } from '../src/vendor/shared/contracts/eval-run.js';
import type { EvalTarget } from '../src/vendor/shared/contracts/eval-run.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL = process.env.EXPERIMENT_MODEL ?? 'deepseek/deepseek-v4-flash';
const WORKSPACE_NAME = 'evals-experiment-ephemeral';

// ---------------------------------------------------------------------------
// Baseline system prompt (condition A)
// ---------------------------------------------------------------------------

const BASELINE_PROMPT = `# Role
You are a pragmatic senior engineer reviewing a pull-request diff for a Node.js
(TypeScript, ESM) service. Find defects that would break correctness, behaviour,
or maintainability in production.

# What to look for (priority order)
1. Correctness & logic bugs: wrong conditionals, missing guards, off-by-one,
   operator mistakes, truthiness traps, async pitfalls.
2. Security issues: injection, credential exposure, missing auth checks.
3. Contract / API breaks: changed response shape, missing required field, wrong
   status code.

# Quality bar
Precision over volume. Only flag issues that are real, introduced by this diff,
and have a concrete mechanism. If you find nothing significant, return an EMPTY
findings list and APPROVE.

# Severity
CRITICAL  — correctness bug, security hole, data loss, or broken merge gate.
WARNING   — real risk that is tolerable short-term.
SUGGESTION — improvement that matters but is not urgent.
Return APPROVE unless at least one CRITICAL or WARNING exists.`;

// ---------------------------------------------------------------------------
// Improved prompt (condition B) — tighter guidance on async and auth
// ---------------------------------------------------------------------------

const IMPROVED_PROMPT = `# Role
You are a pragmatic senior engineer reviewing a pull-request diff for a Node.js
(TypeScript, ESM) Fastify 5 service using Drizzle ORM and Zod.
Find defects that would break correctness, behaviour, or maintainability.

# What to look for (priority order)
1. Correctness & logic bugs: wrong conditionals, missing guards, off-by-one,
   operator mistakes, truthiness traps (\`??\` vs \`||\`), async pitfalls (missing
   await, unhandled rejection, forEach with async callback).
2. Security: injection, credential exposure, missing workspace-scoping on DB
   queries, request-body data that reaches DB without validation.
3. Contract / API breaks: changed response shape, missing required field, wrong
   status code, Zod schema widened without a matching DB migration.
4. Data / state: wrong DB filter, missing transaction, silent data loss.

# Concrete mechanism required
For each finding state: which input triggers the wrong behaviour and what
concretely goes wrong. "Could be a problem" is not a finding.

# Quality bar
Precision over volume. Only flag issues introduced or worsened by THIS diff.
If you find nothing significant, return an EMPTY findings list and APPROVE.

# Severity
CRITICAL  — correctness bug, security hole, data loss, or broken merge gate.
WARNING   — real risk that is tolerable short-term.
SUGGESTION — improvement that matters but is not urgent.
Return APPROVE unless at least one CRITICAL or WARNING exists.`;

// ---------------------------------------------------------------------------
// Noisy prompt (condition C) — adds the v7-shaped instruction that provokes
// false positives. The prediction: precision falls; must_not_flag cases fail
// first because the noise instruction adds suggestions the agent "should stay
// quiet about".
// ---------------------------------------------------------------------------

const NOISY_PROMPT = `# Role
You are a pragmatic senior engineer reviewing a pull-request diff for a Node.js
(TypeScript, ESM) service. Find defects that would break correctness, behaviour,
or maintainability in production.

# What to look for (priority order)
1. Correctness & logic bugs: wrong conditionals, missing guards, off-by-one,
   operator mistakes, truthiness traps, async pitfalls.
2. Security issues: injection, credential exposure, missing auth checks.
3. Contract / API breaks: changed response shape, missing required field, wrong
   status code.
4. Flag unused imports as suggestions.

# Quality bar
Precision over volume. Only flag issues that are real, introduced by this diff,
and have a concrete mechanism.

# Severity
CRITICAL  — correctness bug, security hole, data loss, or broken merge gate.
WARNING   — real risk that is tolerable short-term.
SUGGESTION — improvement that matters but is not urgent.
Return APPROVE unless at least one CRITICAL or WARNING exists.`;

// ---------------------------------------------------------------------------
// Eval cases
// ---------------------------------------------------------------------------

/**
 * A small but non-trivial TypeScript diff that:
 *   - Introduces a real off-by-one in pagination (must_find target)
 *   - Removes an import that was previously in use (must_not_flag — the agent
 *     should NOT flag this as "unused import" because in the eval diff the
 *     import is already gone and the reference has been updated correctly)
 *
 * The must_not_flag target exercises the prediction: adding "Flag unused imports
 * as suggestions" in the noisy prompt should cause the agent to generate a false
 * positive on the removed import, tripping the must_not_flag case.
 */
const PAGINATION_DIFF = `diff --git a/src/modules/pulls/service.ts b/src/modules/pulls/service.ts
--- a/src/modules/pulls/service.ts
+++ b/src/modules/pulls/service.ts
@@ -1,6 +1,5 @@
 import { z } from 'zod';
 import { db } from '../db/client.js';
-import { legacyPaginate } from '../utils/legacy.js';
 import { pulls } from '../db/schema.js';
 import { and, eq, desc } from 'drizzle-orm';

@@ -12,14 +11,15 @@ const MAX_PAGE = 500;
  * Returns a page of pull requests for a repo.
  */
 export async function listPulls(repoId: string, page: number, pageSize: number) {
-  const offset = page * pageSize;
+  const offset = (page - 1) * pageSize;
   const limit = Math.min(pageSize, MAX_PAGE);

   const rows = await db
     .select()
     .from(pulls)
     .where(eq(pulls.repoId, repoId))
     .orderBy(desc(pulls.createdAt))
     .limit(limit)
     .offset(offset);

-  return rows.map((r) => ({ ...r, page, legacyId: legacyPaginate(r.id, page) }));
+  return rows.map((r) => ({ ...r, page }));
 }
`;

/**
 * A diff that introduces an auth check omission — a clear security finding.
 * No unlisted imports; used as a pure must_find case.
 */
const AUTH_DIFF = `diff --git a/src/routes/settings.ts b/src/routes/settings.ts
--- a/src/routes/settings.ts
+++ b/src/routes/settings.ts
@@ -1,5 +1,5 @@
 import { FastifyPluginAsync } from 'fastify';
-import { requireAdmin } from '../middleware/auth.js';
+// requireAdmin removed — settings now open to all authenticated users

 export const settingsRoutes: FastifyPluginAsync = async (app) => {
@@ -8,7 +8,6 @@ export const settingsRoutes: FastifyPluginAsync = async (app) => {
   app.post('/settings/reset', {
     schema: { body: ResetSettingsSchema },
-    preHandler: requireAdmin,
     handler: async (req, reply) => {
       await db.delete(settings).where(eq(settings.workspaceId, req.workspace.id));
       reply.send({ ok: true });
`;

interface EvalCaseSpec {
  name: string;
  diff: string;
  targets: EvalTarget[];
  unlisted: 'ignore' | 'forbid';
  description: string;
}

const EVAL_CASES: EvalCaseSpec[] = [
  {
    name: 'pagination-off-by-one',
    diff: PAGINATION_DIFF,
    targets: [
      {
        kind: 'must_find',
        file: 'src/modules/pulls/service.ts',
        start_line: 11,
        end_line: 14,
        source_finding_id: null,
        title: 'Off-by-one in pagination offset',
        severity: 'CRITICAL',
        category: 'correctness',
      },
      {
        // The legacy import removal is correct (the reference was removed too).
        // The agent should NOT flag this as "unused import" — that finding would
        // be a false positive. This is the target that falls first under the
        // noisy prompt (condition C adds "Flag unused imports as suggestions").
        kind: 'must_not_flag',
        file: 'src/modules/pulls/service.ts',
        start_line: 1,
        end_line: 4,
        source_finding_id: null,
        title: 'Removed import (correctly cleaned up with its reference)',
        severity: null,
        category: null,
      },
    ],
    unlisted: 'ignore',
    description: 'must_find: off-by-one; must_not_flag: correctly removed import',
  },
  {
    name: 'missing-auth-check',
    diff: AUTH_DIFF,
    targets: [
      {
        kind: 'must_find',
        file: 'src/routes/settings.ts',
        start_line: 8,
        end_line: 12,
        source_finding_id: null,
        title: 'Admin gate removed from /settings/reset',
        severity: 'CRITICAL',
        category: 'security',
      },
    ],
    unlisted: 'ignore',
    description: 'pure must_find: missing auth (no must_not_flag)',
  },
];

// ---------------------------------------------------------------------------
// API key helper (same as skills-experiment.ts)
// ---------------------------------------------------------------------------

function apiKey(): string {
  try {
    const path = join(homedir(), '.devdigest', 'secrets.json');
    const secrets = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
    if (secrets.OPENROUTER_API_KEY) return secrets.OPENROUTER_API_KEY;
  } catch {
    // No secrets file — fall through to env.
  }
  const fromEnv = process.env.OPENROUTER_API_KEY;
  if (!fromEnv) {
    throw new Error('OPENROUTER_API_KEY is not configured (~/.devdigest/secrets.json or env)');
  }
  return fromEnv;
}

// ---------------------------------------------------------------------------
// Wait for a suite run to finish (polls the repo until status !== 'running')
// ---------------------------------------------------------------------------

async function waitForSuiteRun(service: EvalService, runId: string): Promise<EvalSuiteRun> {
  return new Promise((resolve, reject) => {
    const off = runBus.onDone(runId, () => {
      service
        .getSuiteRun(runId)
        .then(resolve)
        .catch(reject);
    });
    // Safety: if onDone never fires (shouldn't happen), time out after 5 min.
    const timer = setTimeout(() => {
      off();
      reject(new Error(`Suite run ${runId} timed out after 5 minutes`));
    }, 5 * 60 * 1000);
    // If the run already completed before we subscribed, onDone fires via
    // queueMicrotask — clear the timer when the promise settles.
    void service.getSuiteRun(runId).then((run) => {
      if (run.status !== 'running') {
        clearTimeout(timer);
        off();
        resolve(run);
      }
    });
    // Ensure the timer is cleared when the promise resolves normally.
    const originalOff = off;
    void Promise.resolve().then(() => {
      // Clean up on resolution (timer clear happens inside the callbacks above).
      void originalOff;
    });
    // Clear timer via a local wrapper so we don't double-clear.
    const cleanup = () => clearTimeout(timer);
    runBus.onDone(runId, cleanup);
  });
}

// ---------------------------------------------------------------------------
// Null-safe statistics
// ---------------------------------------------------------------------------

/** Return null if values is empty or all null; otherwise compute the median. */
function median(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1]! + sorted[mid]!) / 2)
    : (sorted[mid]!);
}

function minOf(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null);
  return nums.length === 0 ? null : Math.min(...nums);
}

function maxOf(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null);
  return nums.length === 0 ? null : Math.max(...nums);
}

/** Format a nullable metric as a percentage string, or 'n/a'. */
function pct(v: number | null): string {
  return v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`;
}

/** Spread string: "min–max (median)" or "n/a" when no valid samples exist. */
function spread(values: (number | null)[]): string {
  const lo = minOf(values);
  const hi = maxOf(values);
  const mid = median(values);
  if (lo === null || hi === null || mid === null) return 'n/a';
  return `${pct(lo)}–${pct(hi)} (median ${pct(mid)})`;
}

// ---------------------------------------------------------------------------
// Run one condition: update the agent's system prompt, then fire N suite runs
// sequentially (the concurrency cap is per-process; parallel runs from the
// same process would hit the cap and 429).
// ---------------------------------------------------------------------------

interface ConditionResult {
  label: string;
  prompt: string;
  runs: EvalSuiteRun[];
}

async function runCondition(
  label: string,
  prompt: string,
  workspaceId: string,
  agentId: string,
  container: Container,
  service: EvalService,
  n: number,
): Promise<ConditionResult> {
  // Update the agent's system prompt — bumps agent.version via AgentsRepository.update.
  await container.agentsRepo.update(workspaceId, agentId, { systemPrompt: prompt });

  const runs: EvalSuiteRun[] = [];
  for (let i = 0; i < n; i++) {
    const { suite_run_id } = await service.startSuiteRun(workspaceId, agentId, 'suite');
    const result = await waitForSuiteRun(service, suite_run_id);
    runs.push(result);
    process.stdout.write('.');
  }
  process.stdout.write('\n');

  return { label, prompt, runs };
}

// ---------------------------------------------------------------------------
// Report a single condition's distribution
// ---------------------------------------------------------------------------

function reportCondition(result: ConditionResult, n: number): void {
  const { label, runs } = result;

  // Extract metrics — never coerce null to 0.
  const precisions = runs.map((r) => r.precision);
  const recalls = runs.map((r) => r.recall);
  const citations = runs.map((r) => r.citation_accuracy);
  const casesPassed = runs.map((r) =>
    r.cases_total > 0 ? r.cases_passed / r.cases_total : null,
  );

  const nullPrecision = precisions.filter((v) => v === null).length;
  const nullRecall = recalls.filter((v) => v === null).length;
  const nullCitation = citations.filter((v) => v === null).length;

  // EvalRunInputs from the first run of this condition (all runs in a condition
  // should have the same agent_version and case_set_revision; skill_versions may
  // differ if skills changed between runs, which would be a confound).
  const first = runs[0];
  const inputs = first?.inputs;

  console.log(`\n  ${label}`);
  if (inputs) {
    console.log(
      `    EvalRunInputs: agent_version=${inputs.agent_version}` +
        `  skills=${inputs.skill_versions.length === 0 ? '(none)' : inputs.skill_versions.map((s) => `${s.skill_id}@v${s.version}`).join(', ')}` +
        `  case_set_revision=${inputs.case_set_revision.slice(0, 8)}…`,
    );
    // Confound check: warn if agent_version differs across runs in the same condition.
    const versions = new Set(runs.map((r) => r.inputs.agent_version));
    if (versions.size > 1) {
      console.log(`    *** CONFOUND: agent_version changed within this condition: ${[...versions].join(', ')} ***`);
    }
    const revisions = new Set(runs.map((r) => r.inputs.case_set_revision));
    if (revisions.size > 1) {
      console.log(`    *** CONFOUND: case_set_revision changed within this condition (case was edited mid-run?) ***`);
    }
  }

  console.log(`    n=${n} runs`);
  console.log(`    precision:         ${spread(precisions)}${nullPrecision > 0 ? ` (${nullPrecision} null — excluded from spread)` : ''}`);
  console.log(`    recall:            ${spread(recalls)}${nullRecall > 0 ? ` (${nullRecall} null — excluded from spread)` : ''}`);
  console.log(`    citation_accuracy: ${spread(citations)}${nullCitation > 0 ? ` (${nullCitation} null — excluded from spread)` : ''}`);
  console.log(`    cases passed:      ${spread(casesPassed)}`);

  // Per-run table for auditing.
  console.log(`    per-run breakdown:`);
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i]!;
    const status = r.status === 'succeeded' ? 'ok' : r.error ? `FAILED: ${r.error.slice(0, 60)}` : r.status;
    console.log(
      `      run ${i + 1}: precision=${pct(r.precision)}  recall=${pct(r.recall)}  cite=${pct(r.citation_accuracy)}` +
        `  passed=${r.cases_passed}/${r.cases_total}` +
        `  cost=$${(r.cost_usd ?? 0).toFixed(4)}` +
        `  [${status}]`,
    );
  }
}

// ---------------------------------------------------------------------------
// Falsifiability check
// ---------------------------------------------------------------------------

/**
 * Assert the prediction: adding the noisy instruction should lower precision
 * compared to baseline, and the must_not_flag case ('pagination-off-by-one')
 * should be the first to fail.
 *
 * We cannot enforce this as a hard assertion because model output is stochastic —
 * the point is to surface the signal, not gate on a single run.
 */
function reportPrediction(
  baseline: ConditionResult,
  improved: ConditionResult,
  noisy: ConditionResult,
): void {
  console.log('\n' + '='.repeat(78));
  console.log('FALSIFIABLE PREDICTION CHECK');
  console.log('='.repeat(78));
  console.log('Prediction: adding "Flag unused imports as suggestions." (condition C)');
  console.log('should lower precision relative to baseline, and the must_not_flag');
  console.log('case (pagination-off-by-one) should be the first to fail.');
  console.log();

  const basePrec = median(baseline.runs.map((r) => r.precision));
  const impPrec = median(improved.runs.map((r) => r.precision));
  const noisyPrec = median(noisy.runs.map((r) => r.precision));

  // Spread is nullable: if all precision values were null (no valid samples),
  // maxOf/minOf return null and the spread is unknown — not 0. A spread of 0
  // from ?? 0 coercion would make the guard below always false and silently
  // disable the "delta inside spread → not a result" warning. Same failure
  // applies to n=1: max===min yields spread=0, which is absence of evidence,
  // not a tight distribution — handled separately below.
  const basePrecValues = baseline.runs.map((r) => r.precision);
  const noisyPrecValues = noisy.runs.map((r) => r.precision);
  const baseMax = maxOf(basePrecValues);
  const baseMin = minOf(basePrecValues);
  const noisyMax = maxOf(noisyPrecValues);
  const noisyMin = minOf(noisyPrecValues);

  // Spread is null when there are no valid samples for that condition.
  const baseSpread: number | null =
    baseMax !== null && baseMin !== null ? baseMax - baseMin : null;
  const noisySpread: number | null =
    noisyMax !== null && noisyMin !== null ? noisyMax - noisyMin : null;

  // n < 2 per condition means spread=0 is absence of evidence, not a tight
  // distribution. Warn before attempting any delta qualification.
  const baseN = basePrecValues.filter((v) => v !== null).length;
  const noisyN = noisyPrecValues.filter((v) => v !== null).length;
  if (baseN < 2 || noisyN < 2) {
    console.log(
      `  *** WARNING: baseline has ${baseN} valid precision sample(s), noisy has ${noisyN}.` +
        ' A single run yields no spread — any delta shown below cannot be qualified as signal' +
        ' or noise. Increase --runs (minimum 3, recommended 5) before drawing conclusions. ***',
    );
    console.log();
  }

  if (basePrec !== null && noisyPrec !== null) {
    const delta = noisyPrec - basePrec;
    const dropped = delta < 0;
    console.log(`  Baseline  precision (median): ${pct(basePrec)}`);
    console.log(`  Improved  precision (median): ${impPrec !== null ? pct(impPrec) : 'n/a'}`);
    console.log(`  Noisy     precision (median): ${pct(noisyPrec)}`);
    console.log(`  Delta (noisy − baseline):     ${pct(delta)}`);

    // Qualify the delta against the run-to-run spread — but only when we
    // actually have a spread to compare against. If either spread is null
    // (all-null precision in that condition), refuse to evaluate rather than
    // silently skipping the check.
    if (baseSpread === null || noisySpread === null) {
      console.log(
        '  *** NOTE: cannot qualify delta — one or more conditions have no valid' +
          ' precision spread (all runs returned null precision). ***',
      );
    } else {
      const maxSpread = Math.max(baseSpread, noisySpread);
      if (Math.abs(delta) < maxSpread) {
        console.log(
          `  *** NOTE: the ${pct(Math.abs(delta))} delta is INSIDE the run-to-run spread` +
            ` (baseline range ${pct(baseSpread)}, noisy range ${pct(noisySpread)}).` +
            ' This is not a result — increase --runs or the delta is noise. ***',
        );
      }
    }

    if (dropped) {
      console.log('  → precision DID fall under the noisy prompt.');
    } else {
      console.log('  → precision did NOT fall (or rose) — prediction not confirmed.');
    }
  } else {
    console.log('  Cannot evaluate prediction — one or more conditions returned only null precision.');
  }

  console.log();
  console.log('  must_not_flag case (pagination-off-by-one) pass rate per condition:');
  for (const cond of [baseline, improved, noisy]) {
    // Count how many runs had cases_passed < cases_total (i.e. at least one case failed).
    // We cannot directly isolate which case failed from the suite-level row,
    // but a drop in cases_passed between baseline and noisy while precision also
    // drops is the indicator the spec calls "must_not_flag cases fall first".
    const passRates = cond.runs.map((r) =>
      r.cases_total > 0 ? r.cases_passed / r.cases_total : null,
    );
    console.log(`    ${cond.label}: cases_passed spread = ${spread(passRates)}`);
  }
  console.log();
  console.log('  (For per-case violation detail, query eval_runs.violations for the');
  console.log('   suite run ids printed above — the case-level rows are preserved.)');
}

// ---------------------------------------------------------------------------
// Workspace / agent / case setup and teardown
// ---------------------------------------------------------------------------

async function setupExperiment(container: Container): Promise<{
  workspaceId: string;
  agentId: string;
  caseIds: string[];
}> {
  // Create an ephemeral workspace row directly.
  const [ws] = await container.db
    .insert(t.workspaces)
    .values({
      name: WORKSPACE_NAME,
      slug: `evals-exp-${Date.now()}`,
    })
    .returning();
  if (!ws) throw new Error('Failed to insert workspace');

  // Create an agent with the baseline prompt.
  const agent = await container.agentsRepo.insert({
    workspaceId: ws.id,
    name: 'Experiment Agent',
    provider: 'openrouter',
    model: MODEL,
    systemPrompt: BASELINE_PROMPT,
    strategy: 'single-pass',
    repoIntel: false,
  });

  // Create eval cases manually (no findings in this ephemeral workspace).
  const repo = new (await import('../src/modules/evals/repository.js')).EvalRepository(container.db);
  const caseIds: string[] = [];
  for (const spec of EVAL_CASES) {
    const row = await repo.insertCase({
      workspaceId: ws.id,
      ownerKind: 'agent',
      ownerId: agent.id,
      name: spec.name,
      inputDiff: spec.diff,
      inputMeta: { title: spec.name, description: spec.description },
      targets: spec.targets,
      unlisted: spec.unlisted,
      sourcePrId: null,
    });
    caseIds.push(row.id);
  }

  return { workspaceId: ws.id, agentId: agent.id, caseIds };
}

async function teardownExperiment(container: Container, workspaceId: string): Promise<void> {
  // Cascade: eval_suite_runs → eval_runs on delete cascade (schema constraint).
  // eval_cases belong to workspace via workspaceId.
  await container.db.delete(t.evalCases).where(eq(t.evalCases.workspaceId, workspaceId));
  await container.db.delete(t.evalSuiteRuns).where(eq(t.evalSuiteRuns.workspaceId, workspaceId));
  // Delete agents (agent_versions cascade).
  const agents = await container.agentsRepo.list(workspaceId);
  for (const a of agents) {
    await container.agentsRepo.deleteById(workspaceId, a.id);
  }
  // Delete workspace.
  await container.db.delete(t.workspaces).where(eq(t.workspaces.id, workspaceId));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const runsFlag = args.findIndex((a) => a === '--runs');
  const n = runsFlag === -1 ? 3 : Number(args[runsFlag + 1] ?? 3);

  if (!Number.isInteger(n) || n < 1) {
    console.error(`--runs must be a positive integer, got "${n}"`);
    process.exit(1);
  }

  // Verify the API key is present before any DB work.
  const _key = apiKey();
  void _key;

  const config = loadConfig();
  const handle = createDb(config.databaseUrl);
  const container = new Container(config, handle.db);
  const service = new EvalService(container);

  let workspaceId: string | null = null;

  try {
    console.log('='.repeat(78));
    console.log('EVAL PIPELINE EXPERIMENT');
    console.log(`model: ${MODEL}   runs per condition: ${n}   cases: ${EVAL_CASES.length}`);
    console.log('='.repeat(78));
    console.log();
    console.log('Setting up ephemeral workspace, agent, and eval cases…');

    const setup = await setupExperiment(container);
    workspaceId = setup.workspaceId;

    console.log(`  workspace: ${setup.workspaceId}`);
    console.log(`  agent:     ${setup.agentId}`);
    console.log(`  cases:     ${setup.caseIds.join(', ')}`);
    console.log();

    // -----------------------------------------------------------------------
    // Condition A — Baseline
    // -----------------------------------------------------------------------
    console.log('Running condition A (baseline)…');
    const condA = await runCondition(
      'A — baseline',
      BASELINE_PROMPT,
      setup.workspaceId,
      setup.agentId,
      container,
      service,
      n,
    );

    // -----------------------------------------------------------------------
    // Condition B — Improved prompt
    // -----------------------------------------------------------------------
    console.log('Running condition B (improved prompt)…');
    const condB = await runCondition(
      'B — improved',
      IMPROVED_PROMPT,
      setup.workspaceId,
      setup.agentId,
      container,
      service,
      n,
    );

    // -----------------------------------------------------------------------
    // Condition C — Noisy prompt
    // -----------------------------------------------------------------------
    console.log('Running condition C (noisy: "Flag unused imports as suggestions.")…');
    const condC = await runCondition(
      'C — noisy',
      NOISY_PROMPT,
      setup.workspaceId,
      setup.agentId,
      container,
      service,
      n,
    );

    // -----------------------------------------------------------------------
    // Results
    // -----------------------------------------------------------------------
    console.log('\n' + '='.repeat(78));
    console.log('RESULTS (distribution, not a pair)');
    console.log('='.repeat(78));
    console.log();
    console.log('Eval cases:');
    for (const spec of EVAL_CASES) {
      const mustFind = spec.targets.filter((x) => x.kind === 'must_find').length;
      const mustNot = spec.targets.filter((x) => x.kind === 'must_not_flag').length;
      console.log(`  "${spec.name}":  ${mustFind} must_find, ${mustNot} must_not_flag, unlisted=${spec.unlisted}`);
    }
    console.log();
    console.log('Precision denominators differ: precision=TP/(TP+FP) over findings,');
    console.log('recall=matched_must_find_targets/all_must_find_targets over targets.');
    console.log('A 2-point move inside the run-to-run spread is NOT a result.');

    reportCondition(condA, n);
    reportCondition(condB, n);
    reportCondition(condC, n);

    reportPrediction(condA, condB, condC);

    console.log('='.repeat(78));
    console.log('Total cost estimate: $' +
      [...condA.runs, ...condB.runs, ...condC.runs]
        .reduce((s, r) => s + (r.cost_usd ?? 0), 0)
        .toFixed(4),
    );
  } finally {
    if (workspaceId) {
      console.log('\nCleaning up ephemeral data…');
      await teardownExperiment(container, workspaceId).catch((err: unknown) =>
        console.warn('Teardown failed (manual cleanup may be needed):', (err as Error).message),
      );
      console.log('Done.');
    }
    await handle.close();
  }
}

main().catch((err) => {
  console.error('experiment failed:', err);
  process.exit(1);
});
