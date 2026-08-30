import { and, eq } from 'drizzle-orm';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError, ValidationError } from '../../platform/errors.js';
import type { EvalRunRecord, EvalDashboard, EvalTrendPoint, EvalSuiteRunDetail } from '../../vendor/shared/contracts/eval-ci.js';
import type { EvalCase } from '../../vendor/shared/contracts/knowledge.js';
import { AgentVersionConfig } from '../../vendor/shared/contracts/knowledge.js';
import type { EvalSuiteRun, EvalTarget, EvalGlobalDashboard, EvalRunAllResult } from '../../vendor/shared/contracts/eval-run.js';
import * as t from '../../db/schema.js';
import { EvalRepository } from './repository.js';
import { EvalExecutor } from './executor.js';
import { isMeasurementChange, caseSetRevision } from './helpers.js';
import { scoreSet } from './scoring.js';
import type { CaseScore, CitationInput } from './scoring.js';
import { prFilesToDiffText } from '../reviews/diff-loader.js';

/**
 * Maximum concurrent suite runs (Decision B — cost control).
 */
const MAX_CONCURRENT_SUITE_RUNS = 2;

/**
 * Per-run USD ceiling. When exceeded the run is aborted, marked failed with
 * an explicit error, and partial results remain readable (Decision B).
 */
const MAX_COST_USD = 5.0;

/**
 * Total USD ceiling for a single "Run all agents" fan-out (Decision B).
 *
 * The per-route rate limit does not address the fact that "Run all agents"
 * fans out to N agent runs sequentially. This cap accumulates cost_usd across
 * all completed agent runs in the fan-out and stops starting new agents when
 * the ceiling is breached. Already-completed runs are left intact.
 */
const MAX_RUN_ALL_COST_USD = 20.0;

/** In-process count of active suite runs (module-level, one server instance). */
let activeSuiteRuns = 0;

// ---------------------------------------------------------------------------
// Module-level helper — used by runAllAgents fan-out
// ---------------------------------------------------------------------------

/**
 * Await completion of a suite run via runBus.onDone, then read its cost_usd.
 *
 * Pattern from server/INSIGHTS.md "What Works" 2026-08-29 and
 * server/scripts/evals-experiment.ts (waitForSuiteRun). Returns the cost_usd
 * of the completed run (null when the run had no cost recorded).
 *
 * DO NOT poll getSuiteRun in a sleep loop — complete() fires before the DB
 * write commits, so a tight poll reads status='running' after onDone fires.
 */
function waitForSuiteRun(
  container: Container,
  suiteRunId: string,
): Promise<number | null> {
  return new Promise<number | null>((resolve) => {
    const offDone = container.runBus.onDone(suiteRunId, () => {
      offDone();
      // Read cost_usd from DB inside the callback. The DB write commits shortly
      // after complete() fires; a microtask delay is sufficient for the write
      // to land before we query.
      queueMicrotask(() => {
        void container.db
          .select({ costUsd: t.evalSuiteRuns.costUsd })
          .from(t.evalSuiteRuns)
          .where(eq(t.evalSuiteRuns.id, suiteRunId))
          .then(([row]) => resolve(row?.costUsd ?? null))
          .catch(() => resolve(null));
      });
    });
  });
}

export class EvalService {
  private repo: EvalRepository;
  private executor: EvalExecutor;

  constructor(private container: Container) {
    this.repo = new EvalRepository(container.db);
    this.executor = new EvalExecutor(container);
  }

  // =========================================================================
  // Case creation from a finding (criteria 1, 2, 3, 4, 5)
  // =========================================================================

  /**
   * Create (or fold into an existing) eval case from an accepted or dismissed
   * finding.
   *
   * Derivation order (spec §Case creation):
   *   accepted_at  → kind = 'must_find'
   *   dismissed_at → kind = 'must_not_flag'
   *   neither      → 422 (undecided finding — criterion 3)
   *
   * Fold rule: when (ownerId, sourcePrId) already has a case, append the new
   * target and bump revision rather than creating a second case (criterion 5).
   *
   * Idempotency: if source_finding_id is already in the case's targets, return
   * that case with no modification (criterion 2).
   *
   * Returns { evalCase, created: true } on create, { created: false } on hit.
   */
  async createCaseFromFinding(
    workspaceId: string,
    findingId: string,
  ): Promise<{ evalCase: EvalCase; created: boolean }> {
    // Load the finding, scoped via workspace (through reviews join).
    const findingRow = await this.loadFinding(workspaceId, findingId);
    if (!findingRow) throw new NotFoundError('Finding not found');

    const review = await this.container.reviewRepo.getReview(findingRow.reviewId);
    if (!review) throw new NotFoundError('Review not found for this finding');

    // Decision A: hide button when no agent_id — 422 here for API consumers.
    if (!review.agentId) {
      throw new AppError(
        'no_agent',
        'This finding has no agent owner — eval cases can only be created for agent-reviewed findings',
        422,
      );
    }

    // Criterion 3: 422 on undecided finding.
    const isAccepted = findingRow.acceptedAt !== null;
    const isDismissed = findingRow.dismissedAt !== null;
    if (!isAccepted && !isDismissed) {
      throw new ValidationError(
        'Finding must be accepted or dismissed before turning it into an eval case',
      );
    }

    const kind: EvalTarget['kind'] = isAccepted ? 'must_find' : 'must_not_flag';
    const newTarget: EvalTarget = {
      kind,
      file: findingRow.file,
      start_line: findingRow.startLine,
      end_line: findingRow.endLine,
      source_finding_id: findingRow.id,
      severity: findingRow.severity as EvalTarget['severity'],
      category: findingRow.category as EvalTarget['category'],
      title: findingRow.title,
    };

    // Load the PR for source_pr_id and diff text.
    const pull = await this.container.reviewRepo.getPull(workspaceId, review.prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    // Fold rule: does a case for (ownerId, sourcePrId) already exist?
    const existing = await this.repo.findCaseByOwnerAndPr(review.agentId, pull.id);

    if (existing) {
      // Idempotency: source_finding_id already present — return as-is.
      const alreadyPresent = existing.targets.some(
        (tgt: EvalTarget) => tgt.source_finding_id === findingId,
      );
      if (alreadyPresent) {
        return { evalCase: existing, created: false };
      }

      // Fold: append target + bump revision (criterion 5).
      await this.repo.appendTargetAndBump(existing.id, newTarget);
      const updated = await this.repo.getCase(workspaceId, existing.id);
      if (!updated) throw new Error('Case disappeared after update');
      return { evalCase: updated, created: false };
    }

    // Create new case. input_diff = whole PR diff (never a trimmed hunk).
    const inputDiff = await prFilesToDiffText(this.container.reviewRepo, pull.id);
    const inputMeta = { title: pull.title, body: pull.body ?? '' };

    // Name derived from PR title; falls back to finding title.
    const name = pull.title
      ? `PR: ${pull.title.slice(0, 80)}`
      : `Finding: ${findingRow.title.slice(0, 80)}`;

    const row = await this.repo.insertCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: review.agentId,
      name,
      inputDiff,
      inputMeta,
      targets: [newTarget],
      unlisted: 'ignore',
      sourcePrId: pull.id,
    });

    const newCase = await this.repo.getCase(workspaceId, row.id);
    if (!newCase) throw new Error('Case disappeared after insert');
    return { evalCase: newCase, created: true };
  }

  // =========================================================================
  // Case CRUD
  // =========================================================================

  async listCases(workspaceId: string, agentId: string): Promise<EvalCase[]> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    return this.repo.listCases(agentId);
  }

  /** Manually create an eval case (without deriving from a finding). */
  async createCase(
    workspaceId: string,
    agentId: string,
    body: {
      name: string;
      input_diff?: string;
      input_meta?: unknown;
      targets?: EvalTarget[];
      unlisted?: 'ignore' | 'forbid';
      notes?: string | null;
    },
  ): Promise<EvalCase> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const row = await this.repo.insertCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name: body.name,
      inputDiff: body.input_diff ?? '',
      inputMeta: body.input_meta ?? null,
      targets: body.targets ?? [],
      unlisted: body.unlisted ?? 'ignore',
      sourcePrId: null,
    });

    const evalCase = await this.repo.getCase(workspaceId, row.id);
    if (!evalCase) throw new Error('Case disappeared after insert');
    return evalCase;
  }

  async getCase(workspaceId: string, caseId: string): Promise<EvalCase> {
    const c = await this.repo.getCase(workspaceId, caseId);
    if (!c) throw new NotFoundError('Eval case not found');
    return c;
  }

  async updateCase(
    workspaceId: string,
    caseId: string,
    patch: {
      name?: string;
      notes?: string | null;
      targets?: EvalTarget[];
      unlisted?: 'ignore' | 'forbid';
      inputDiff?: string;
    },
  ): Promise<EvalCase> {
    const existing = await this.repo.getCase(workspaceId, caseId);
    if (!existing) throw new NotFoundError('Eval case not found');

    // isMeasurementChange: only input_diff, targets, unlisted bump revision.
    const bump = isMeasurementChange(existing, patch);

    await this.repo.updateCase(caseId, { ...patch, bumpRevision: bump });

    const updated = await this.repo.getCase(workspaceId, caseId);
    if (!updated) throw new Error('Case disappeared after update');
    return updated;
  }

  async deleteCase(workspaceId: string, caseId: string): Promise<boolean> {
    return this.repo.deleteCase(workspaceId, caseId);
  }

  // =========================================================================
  // Run orchestration (criteria 1, 8, 10, 13, 14, 16, Decision B)
  // =========================================================================

  /**
   * Start a suite run for an agent. Returns the suite_run_id immediately and
   * executes in the background (fire-and-forget, 202 pattern).
   *
   * scope='suite' → enters trends/aggregates.
   * scope='case'  → single-case debug run, excluded from trends (criterion 16).
   */
  async startSuiteRun(
    workspaceId: string,
    agentId: string,
    scope: 'suite' | 'case' = 'suite',
    caseIds?: string[],
  ): Promise<{ suite_run_id: string }> {
    // Cost control: concurrency cap (Decision B).
    if (activeSuiteRuns >= MAX_CONCURRENT_SUITE_RUNS) {
      throw new AppError(
        'too_many_runs',
        `Too many concurrent eval suite runs (max ${MAX_CONCURRENT_SUITE_RUNS}). Wait for one to finish.`,
        429,
      );
    }

    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const allCases = await this.repo.listCases(agentId);
    const cases = caseIds
      ? allCases.filter((c) => caseIds.includes(c.id))
      : allCases;

    if (cases.length === 0) {
      throw new AppError('no_cases', 'No eval cases found for this agent', 400);
    }

    // Compute case_set_revision — fingerprint over (case_id, revision) pairs.
    const revision = caseSetRevision(
      cases.map((c) => ({ id: c.id, revision: c.revision })),
    );

    // Pin skill versions AT RUN START — read from skill_versions, not skills.body.
    // This is the freeze: the executor uses these bodies, never the live row.
    const linkedSkills = await this.container.agentsRepo.linkedSkills(agentId);
    const skillVersionRecords: Array<{ skill_id: string; version: number; body: string }> = [];
    for (const link of linkedSkills) {
      if (!link.skill.enabled) continue;
      const [versionRow] = await this.container.db
        .select({ body: t.skillVersions.body })
        .from(t.skillVersions)
        .where(
          and(
            eq(t.skillVersions.skillId, link.skill.id),
            eq(t.skillVersions.version, link.skill.version),
          ),
        );
      // Skill saves ALWAYS create a version snapshot. A missing snapshot is an
      // integrity failure — fall back to the live skills.body would silently
      // mislabel the run (the run records {skill_id, version: N} but executed a
      // different body), confounding every A/B comparison built on it.
      if (!versionRow) {
        throw new AppError(
          'missing_skill_version',
          `Skill version snapshot not found for skill ${link.skill.id} at version ${link.skill.version} — cannot run eval`,
          500,
        );
      }
      const body = versionRow.body;
      skillVersionRecords.push({
        skill_id: link.skill.id,
        version: link.skill.version,
        body,
      });
    }

    // Read agent_version config at the CURRENT version (freeze, criterion 13).
    const versionRow = await this.container.agentsRepo.getVersion(agentId, agent.version);
    if (!versionRow) {
      throw new AppError('missing_version', 'Agent version snapshot not found — cannot run eval', 500);
    }
    const agentVersionConfig = AgentVersionConfig.parse(versionRow.configJson);

    // Insert the suite run row (status = 'running').
    const suiteRunRow = await this.repo.insertSuiteRun({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      agentVersion: agent.version,
      skillVersions: skillVersionRecords.map((s) => ({
        skill_id: s.skill_id,
        version: s.version,
      })),
      caseSetRevision: revision,
      scope,
      casesTotal: cases.length,
    });

    // Fire-and-forget — the HTTP route returns 202 now.
    activeSuiteRuns++;
    void this.executeRunInBackground(
      suiteRunRow.id,
      cases,
      agentVersionConfig,
      skillVersionRecords,
    ).finally(() => {
      activeSuiteRuns--;
    });

    return { suite_run_id: suiteRunRow.id };
  }

  /** Start a single-case debug run (scope='case', excluded from trends). */
  async startCaseRun(
    workspaceId: string,
    agentId: string,
    caseId: string,
  ): Promise<{ suite_run_id: string }> {
    return this.startSuiteRun(workspaceId, agentId, 'case', [caseId]);
  }

  private async executeRunInBackground(
    suiteRunId: string,
    cases: EvalCase[],
    agentVersionConfig: {
      provider: string;
      model: string;
      system_prompt: string;
      strategy: string;
    },
    skillVersionRecords: Array<{ skill_id: string; version: number; body: string }>,
  ): Promise<void> {
    const runStart = Date.now();
    let accumulatedCost = 0;
    const caseScores: CaseScore[] = [];
    const citationInputs: CitationInput[] = [];
    let aborted = false;

    try {
      const provider = agentVersionConfig.provider as 'openai' | 'anthropic' | 'openrouter';
      const model = agentVersionConfig.model;
      const systemPrompt = agentVersionConfig.system_prompt;
      const strategy = (agentVersionConfig.strategy ?? 'single-pass') as
        | 'single-pass'
        | 'map-reduce'
        | 'auto';
      const skillBodies = skillVersionRecords.map((s) => s.body);

      for (const evalCase of cases) {
        // Cost ceiling: abort if accumulated cost exceeds limit (Decision B).
        if (accumulatedCost > MAX_COST_USD) {
          aborted = true;
          this.container.runBus.publish(
            suiteRunId,
            'error',
            `Cost ceiling $${MAX_COST_USD} exceeded — aborting remaining cases`,
          );
          break;
        }

        try {
          const result = await this.executor.runCase(
            suiteRunId,
            evalCase,
            provider,
            model,
            systemPrompt,
            strategy,
            skillBodies,
          );

          await this.repo.insertEvalRun({
            caseId: result.caseId,
            suiteRunId,
            pass: result.pass,
            recall: result.recall,
            precision: result.precision,
            citationAccuracy: result.citationAccuracy,
            durationMs: result.durationMs,
            costUsd: result.costUsd,
            findingsKept: result.findingsKept,
            findingsDropped: result.findingsDropped,
            caseRevision: result.caseRevision,
            violations: result.violations,
            actualOutput: {
              findings_kept: result.findingsKept,
              findings_dropped: result.findingsDropped,
              violations: result.violations,
              missed: result.missed,
            },
          });

          caseScores.push(result.score);
          citationInputs.push(result.citationInput);
          accumulatedCost += result.costUsd ?? 0;
        } catch (err) {
          // Per-case failure is isolated: log and continue.
          this.container.runBus.publish(
            suiteRunId,
            'error',
            `Case "${evalCase.name}" failed: ${(err as Error).message}`,
          );
          await this.repo.insertEvalRun({
            caseId: evalCase.id,
            suiteRunId,
            pass: null,
            recall: null,
            precision: null,
            citationAccuracy: null,
            durationMs: 0,
            costUsd: null,
            findingsKept: 0,
            findingsDropped: 0,
            caseRevision: evalCase.revision,
            violations: [],
            actualOutput: { error: (err as Error).message },
          });
        }
      }

      // Set-level aggregation from completed cases.
      const setScore =
        caseScores.length > 0 ? scoreSet(caseScores, citationInputs) : null;
      const totalKept = citationInputs.reduce((s, c) => s + c.kept, 0);
      const totalDropped = citationInputs.reduce((s, c) => s + c.dropped, 0);

      if (aborted) {
        await this.repo.patchSuiteRun(suiteRunId, {
          status: 'failed',
          finishedAt: new Date(),
          casesPassed: setScore?.cases_passed ?? 0,
          recall: setScore?.recall ?? null,
          precision: setScore?.precision ?? null,
          citationAccuracy: setScore?.citation_accuracy ?? null,
          findingsKept: totalKept,
          findingsDropped: totalDropped,
          durationMs: Date.now() - runStart,
          costUsd: accumulatedCost || null,
          error: `Cost ceiling $${MAX_COST_USD} exceeded — run aborted. Partial results available.`,
        });
      } else {
        await this.repo.patchSuiteRun(suiteRunId, {
          status: 'succeeded',
          finishedAt: new Date(),
          casesPassed: setScore?.cases_passed ?? 0,
          recall: setScore?.recall ?? null,
          precision: setScore?.precision ?? null,
          citationAccuracy: setScore?.citation_accuracy ?? null,
          findingsKept: totalKept,
          findingsDropped: totalDropped,
          durationMs: Date.now() - runStart,
          costUsd: accumulatedCost || null,
          error: null,
        });
      }
    } catch (err) {
      await this.repo
        .patchSuiteRun(suiteRunId, {
          status: 'failed',
          finishedAt: new Date(),
          error: (err as Error).message,
          durationMs: Date.now() - runStart,
        })
        .catch(() => undefined);
    } finally {
      this.container.runBus.complete(suiteRunId);
    }
  }

  // =========================================================================
  // Dashboard aggregation (criterion 16 — scope='suite' filter enforced in repo)
  // =========================================================================

  async getDashboard(workspaceId: string, agentId: string): Promise<EvalDashboard> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const { suiteRuns, caseCount } = await this.repo.getDashboard(agentId);

    // Trend: suite runs in chronological order, succeeded only.
    // case_set_revision is carried on each point so the client can break the
    // line where it changes without joining against recent_runs by ran_at.
    const trend: EvalTrendPoint[] = suiteRuns
      .slice()
      .reverse()
      .filter((r) => r.status === 'succeeded')
      .map(
        (r): EvalTrendPoint => ({
          ran_at: r.ran_at,
          recall: r.recall,
          precision: r.precision,
          citation_accuracy: r.citation_accuracy,
          pass_rate: r.cases_total > 0 ? r.cases_passed / r.cases_total : 0,
          cost_usd: r.cost_usd,
          case_set_revision: r.inputs.case_set_revision,
        }),
      );

    const succeeded = suiteRuns.filter((r) => r.status === 'succeeded');
    const latest = succeeded[0];
    const second = succeeded[1];

    const current = {
      recall: latest?.recall ?? null,
      precision: latest?.precision ?? null,
      citation_accuracy: latest?.citation_accuracy ?? null,
      cases_passed: latest?.cases_passed ?? 0,
      cases_total: latest?.cases_total ?? caseCount,
      cost_usd: latest?.cost_usd ?? null,
    };

    // Null when either operand is null — fabricating a delta from a null
    // denominator would invent a confident regression that never happened
    // (criterion 6 / coordinator item 3).
    const delta = {
      recall:
        latest?.recall != null && second?.recall != null
          ? latest.recall - second.recall
          : null,
      precision:
        latest?.precision != null && second?.precision != null
          ? latest.precision - second.precision
          : null,
      citation_accuracy:
        latest?.citation_accuracy != null && second?.citation_accuracy != null
          ? latest.citation_accuracy - second.citation_accuracy
          : null,
    };

    // Regression alert — surface precision drops > 1pt.
    let alert: string | null = null;
    if (
      latest &&
      second &&
      second.precision !== null &&
      latest.precision !== null
    ) {
      const drop = second.precision - latest.precision;
      if (drop > 0.01) {
        alert = `Precision dipped ${Math.round(drop * 100)}pts on v${latest.inputs.agent_version} vs v${second.inputs.agent_version}`;
      }
    }

    return {
      owner_kind: 'agent',
      owner_id: agentId,
      cases_total: caseCount,
      current,
      delta,
      trend,
      recent_runs: suiteRuns,
      alert,
    };
  }

  async getGlobalDashboard(workspaceId: string): Promise<EvalGlobalDashboard> {
    const { agents, recentRuns } = await this.repo.getGlobalDashboard(workspaceId);
    return { agents, recent_runs: recentRuns };
  }

  /**
   * Fan-out: run eval suite for every agent in the workspace that has at
   * least one eval case. Returns immediately with the list of queued agents
   * (202 pattern). Runs sequentially in the background — one agent at a time,
   * each awaited via runBus.onDone before the next starts.
   *
   * Sequential (not parallel) because startSuiteRun throws 429 when
   * activeSuiteRuns >= MAX_CONCURRENT_SUITE_RUNS (= 2). Running N agents in a
   * loop would 429 on every agent past the second. (Decision B.)
   *
   * A cross-fan-out cost ceiling (MAX_RUN_ALL_COST_USD) stops starting new
   * agents when accumulated cost breaches the limit. Already-completed runs
   * stay readable. Per-agent failure is isolated — one failure does not abort
   * the remaining agents.
   */
  async runAllAgents(workspaceId: string): Promise<EvalRunAllResult> {
    // Resolve agents that have at least one eval case, reusing the existing
    // global dashboard enumeration which already does this join.
    const { agents } = await this.repo.getGlobalDashboard(workspaceId);

    if (agents.length === 0) {
      return { queued: 0, agent_ids: [] };
    }

    const agentIds = agents.map((a) => a.agent_id);

    // Fire-and-forget the sequential fan-out.
    void this.executeRunAllInBackground(workspaceId, agentIds);

    return { queued: agentIds.length, agent_ids: agentIds };
  }

  /**
   * Sequential fan-out background worker.
   *
   * For each agent: start its suite run, wait for completion via runBus.onDone
   * (NOT a sleep loop — see server/INSIGHTS.md "What Works" 2026-08-29),
   * accumulate cost, check the total ceiling before starting the next agent.
   */
  private async executeRunAllInBackground(
    workspaceId: string,
    agentIds: string[],
  ): Promise<void> {
    let totalCostUsd = 0;

    for (const agentId of agentIds) {
      // Check accumulated cost ceiling before starting the next agent.
      if (totalCostUsd > MAX_RUN_ALL_COST_USD) {
        console.warn(
          `runAllAgents: total cost ceiling $${MAX_RUN_ALL_COST_USD} exceeded (accumulated $${totalCostUsd}) — stopping fan-out`,
        );
        break;
      }

      let suiteRunId: string | undefined;
      try {
        const result = await this.startSuiteRun(workspaceId, agentId, 'suite');
        suiteRunId = result.suite_run_id;
      } catch (err) {
        // Per-agent failure (including 429 if another run raced in) is
        // isolated — log and continue to the next agent.
        console.error(
          `runAllAgents: failed to start suite run for agent ${agentId} — continuing. ${(err as Error).message}`,
        );
        continue;
      }

      // Await completion via onDone — do NOT poll getSuiteRun in a sleep loop.
      // complete() fires before the DB write commits; a tight poll would read
      // status = 'running' after onDone has fired and exit prematurely.
      // (server/INSIGHTS.md "What Works" 2026-08-29)
      const costForRun = await waitForSuiteRun(this.container, suiteRunId);
      totalCostUsd += costForRun ?? 0;
    }
  }

  // =========================================================================
  // Suite run reads
  // =========================================================================

  async listSuiteRuns(workspaceId: string, agentId: string): Promise<EvalSuiteRun[]> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    return this.repo.listSuiteRunsForOwner(agentId);
  }

  async getSuiteRun(suiteRunId: string): Promise<EvalSuiteRun> {
    const run = await this.repo.getSuiteRun(suiteRunId);
    if (!run) throw new NotFoundError('Eval suite run not found');
    return run;
  }

  /**
   * Suite run detail: the set-level record plus per-case `EvalRunRecord[]`.
   * Used by `GET /eval-runs/:id` so Phase 3 can render violations / missed.
   */
  async getSuiteRunDetail(suiteRunId: string): Promise<EvalSuiteRunDetail> {
    const run = await this.repo.getSuiteRun(suiteRunId);
    if (!run) throw new NotFoundError('Eval suite run not found');
    const cases = await this.repo.listRunsForSuiteRun(suiteRunId);
    return { ...run, cases };
  }

  async getEvalRunRecords(suiteRunId: string): Promise<EvalRunRecord[]> {
    return this.repo.listRunsForSuiteRun(suiteRunId);
  }

  // =========================================================================
  // Boot reaper (criterion 17)
  // =========================================================================

  async reapStaleSuiteRuns(): Promise<number> {
    return this.repo.reapStaleSuiteRuns();
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  /**
   * Load a finding by id, scoped to workspace via the reviews join.
   * Follows the cross-module rule: reads via container.db, not by importing
   * the reviews module's repository directly.
   */
  private async loadFinding(workspaceId: string, findingId: string) {
    const [row] = await this.container.db
      .select()
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .where(
        and(
          eq(t.findings.id, findingId),
          eq(t.reviews.workspaceId, workspaceId),
        ),
      );
    return row?.findings ?? null;
  }
}
