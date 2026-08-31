import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { EvalTarget } from '../../vendor/shared/contracts/eval-run.js';
import type { EvalCase } from '../../vendor/shared/contracts/knowledge.js';
import type { EvalRunRecord } from '../../vendor/shared/contracts/eval-ci.js';
import type { EvalSuiteRun, EvalSuiteRunStatus, EvalAgentIndexRow } from '../../vendor/shared/contracts/eval-run.js';

/**
 * Eval data-access layer. The ONLY file issuing Drizzle queries against
 * `eval_cases`, `eval_runs`, and `eval_suite_runs`.
 *
 * Onion rule: routes.ts → service.ts → this file. Nothing outside this file
 * imports from `db/schema.ts` for eval tables.
 */

export type EvalCaseRow = typeof t.evalCases.$inferSelect;
export type EvalRunRow = typeof t.evalRuns.$inferSelect;
export type EvalSuiteRunRow = typeof t.evalSuiteRuns.$inferSelect;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve `source_finding_id` for each target in expected_output:
 * left-join `findings` and emit `null` for any target whose finding no longer
 * exists (criterion 12). The targets are stored as jsonb so they carry no FK;
 * this read-time join is the authoritative mechanism for nulling deleted ids.
 */
async function resolveTargetFindingIds(
  db: Db,
  targets: EvalTarget[],
): Promise<EvalTarget[]> {
  // Collect every non-null source_finding_id referenced in the target list.
  const ids = targets
    .map((t) => t.source_finding_id)
    .filter((id): id is string => id !== null);

  if (ids.length === 0) return targets;

  // Find which ids still exist in the findings table.
  const rows = await db
    .select({ id: t.findings.id })
    .from(t.findings)
    .where(inArray(t.findings.id, ids));
  const existing = new Set(rows.map((r) => r.id));

  return targets.map((tgt) => ({
    ...tgt,
    source_finding_id: tgt.source_finding_id !== null && existing.has(tgt.source_finding_id)
      ? tgt.source_finding_id
      : null,
  }));
}

function rowToEvalCase(row: EvalCaseRow, resolvedTargets: EvalTarget[]): EvalCase {
  return {
    id: row.id,
    owner_kind: row.ownerKind as 'skill' | 'agent',
    owner_id: row.ownerId,
    name: row.name,
    input_diff: row.inputDiff ?? '',
    input_files: row.inputFiles ?? null,
    input_meta: row.inputMeta ?? null,
    expected_output: row.expectedOutput,
    notes: row.notes ?? null,
    targets: resolvedTargets,
    unlisted: row.unlisted as 'ignore' | 'forbid',
    source_pr_id: row.sourcePrId ?? null,
    revision: row.revision,
    created_at: row.createdAt.toISOString(),
  };
}

function rowToEvalSuiteRun(row: EvalSuiteRunRow): EvalSuiteRun {
  const inputs = row.skillVersions as Array<{ skill_id: string; version: number }>;
  return {
    id: row.id,
    owner_kind: row.ownerKind as 'skill' | 'agent',
    owner_id: row.ownerId,
    inputs: {
      agent_version: row.agentVersion,
      skill_versions: inputs,
      case_set_revision: row.caseSetRevision,
    },
    scope: row.scope as 'suite' | 'case',
    status: row.status as EvalSuiteRunStatus,
    ran_at: row.ranAt.toISOString(),
    finished_at: row.finishedAt?.toISOString() ?? null,
    cases_total: row.casesTotal,
    cases_passed: row.casesPassed,
    recall: row.recall ?? null,
    precision: row.precision ?? null,
    citation_accuracy: row.citationAccuracy ?? null,
    findings_kept: row.findingsKept,
    findings_dropped: row.findingsDropped,
    duration_ms: row.durationMs ?? null,
    cost_usd: row.costUsd ?? null,
    error: row.error ?? null,
  };
}

function rowToEvalRunRecord(row: EvalRunRow): EvalRunRecord {
  // `missed` is stored inside `actual_output` jsonb (service.ts writes it there).
  // It is NOT a top-level column, so we must deserialize it here.
  // Schema: actual_output = { findings_kept, findings_dropped, violations, missed }
  const ao = (row.actualOutput ?? {}) as Record<string, unknown>;
  const missed = Array.isArray(ao['missed'])
    ? (ao['missed'] as EvalRunRecord['missed'])
    : [];

  return {
    id: row.id,
    case_id: row.caseId,
    case_name: null, // populated by caller when joining
    suite_run_id: row.suiteRunId,
    ran_at: row.ranAt.toISOString(),
    actual_output: row.actualOutput,
    pass: row.pass ?? null,
    recall: row.recall ?? null,
    precision: row.precision ?? null,
    citation_accuracy: row.citationAccuracy ?? null,
    duration_ms: row.durationMs ?? null,
    cost_usd: row.costUsd ?? null,
    findings_kept: row.findingsKept,
    findings_dropped: row.findingsDropped,
    case_revision: row.caseRevision,
    violations: (row.violations as EvalRunRecord['violations']) ?? [],
    missed,
  };
}

// ---------------------------------------------------------------------------
// Public repository class
// ---------------------------------------------------------------------------

export class EvalRepository {
  constructor(private db: Db) {}

  // ---- eval_cases -----------------------------------------------------------

  /** List all cases for an owner (agent or skill). */
  async listCases(ownerId: string): Promise<EvalCase[]> {
    const rows = await this.db
      .select()
      .from(t.evalCases)
      .where(eq(t.evalCases.ownerId, ownerId))
      .orderBy(t.evalCases.createdAt);

    return Promise.all(
      rows.map(async (row) => {
        const rawTargets = (row.expectedOutput ?? []) as EvalTarget[];
        const resolved = await resolveTargetFindingIds(this.db, rawTargets);
        return rowToEvalCase(row, resolved);
      }),
    );
  }

  /** Get a single case by id (workspace-scoped via workspaceId). */
  async getCase(workspaceId: string, caseId: string): Promise<EvalCase | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.id, caseId), eq(t.evalCases.workspaceId, workspaceId)));
    if (!row) return undefined;
    const rawTargets = (row.expectedOutput ?? []) as EvalTarget[];
    const resolved = await resolveTargetFindingIds(this.db, rawTargets);
    return rowToEvalCase(row, resolved);
  }

  /**
   * Find an existing case for (ownerId, sourcePrId) — the fold rule.
   * When accepted + dismissed findings from the same PR are turned into cases,
   * they must land in ONE case, not separate ones.
   */
  async findCaseByOwnerAndPr(
    ownerId: string,
    sourcePrId: string,
  ): Promise<EvalCase | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.ownerId, ownerId), eq(t.evalCases.sourcePrId, sourcePrId)));
    if (!row) return undefined;
    const rawTargets = (row.expectedOutput ?? []) as EvalTarget[];
    const resolved = await resolveTargetFindingIds(this.db, rawTargets);
    return rowToEvalCase(row, resolved);
  }

  /** Insert a new eval case. */
  async insertCase(values: {
    workspaceId: string;
    ownerKind: 'skill' | 'agent';
    ownerId: string;
    name: string;
    inputDiff: string;
    inputMeta: unknown;
    targets: EvalTarget[];
    unlisted: 'ignore' | 'forbid';
    sourcePrId: string | null;
  }): Promise<EvalCaseRow> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: values.ownerKind,
        ownerId: values.ownerId,
        name: values.name,
        inputDiff: values.inputDiff,
        inputMeta: values.inputMeta as object,
        expectedOutput: values.targets as object[],
        unlisted: values.unlisted,
        sourcePrId: values.sourcePrId,
        revision: 1,
      })
      .returning();
    if (!row) throw new Error('insert into eval_cases returned no row');
    return row;
  }

  /**
   * Update an existing eval case. When `bumpRevision` is true, reads the
   * current revision first and increments it. Does NOT scope by workspaceId —
   * the caller (service) must load the case with workspace-scoping first.
   */
  async updateCase(
    caseId: string,
    patch: {
      name?: string;
      targets?: EvalTarget[];
      unlisted?: 'ignore' | 'forbid';
      inputDiff?: string;
      notes?: string | null;
      bumpRevision?: boolean;
    },
  ): Promise<EvalCaseRow | undefined> {
    const set: Partial<typeof t.evalCases.$inferInsert> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.targets !== undefined) set.expectedOutput = patch.targets as object[];
    if (patch.unlisted !== undefined) set.unlisted = patch.unlisted;
    if (patch.inputDiff !== undefined) set.inputDiff = patch.inputDiff;
    if (patch.notes !== undefined) set.notes = patch.notes ?? undefined;

    if (patch.bumpRevision) {
      // Read current revision then write incremented value (same pattern as appendTargetAndBump).
      const [current] = await this.db
        .select({ revision: t.evalCases.revision })
        .from(t.evalCases)
        .where(eq(t.evalCases.id, caseId));
      set.revision = (current?.revision ?? 0) + 1;
    }

    const [row] = await this.db
      .update(t.evalCases)
      .set(set)
      .where(eq(t.evalCases.id, caseId))
      .returning();
    return row;
  }

  /**
   * Append a target to an existing case's expected_output and bump revision.
   * Used by the fold rule: accept+dismiss from the same PR → one case.
   */
  async appendTargetAndBump(caseId: string, target: EvalTarget): Promise<EvalCaseRow | undefined> {
    // Read current targets + revision, then write updated values.
    const [existing] = await this.db
      .select({ expectedOutput: t.evalCases.expectedOutput, revision: t.evalCases.revision })
      .from(t.evalCases)
      .where(eq(t.evalCases.id, caseId));
    if (!existing) return undefined;

    const current = (existing.expectedOutput ?? []) as EvalTarget[];
    const updated = [...current, target];

    const [row] = await this.db
      .update(t.evalCases)
      .set({ expectedOutput: updated as object[], revision: existing.revision + 1 })
      .where(eq(t.evalCases.id, caseId))
      .returning();
    return row;
  }

  /** Delete an eval case (+ its eval_runs via cascade). */
  async deleteCase(workspaceId: string, caseId: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.id, caseId), eq(t.evalCases.workspaceId, workspaceId)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  // ---- eval_suite_runs ------------------------------------------------------

  /** Insert a new suite run row (initial status 'running'). */
  async insertSuiteRun(values: {
    workspaceId: string;
    ownerKind: 'skill' | 'agent';
    ownerId: string;
    agentVersion: number;
    skillVersions: Array<{ skill_id: string; version: number }>;
    caseSetRevision: string;
    scope: 'suite' | 'case';
    casesTotal: number;
  }): Promise<EvalSuiteRunRow> {
    const [row] = await this.db
      .insert(t.evalSuiteRuns)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: values.ownerKind,
        ownerId: values.ownerId,
        agentVersion: values.agentVersion,
        skillVersions: values.skillVersions,
        caseSetRevision: values.caseSetRevision,
        scope: values.scope,
        status: 'running',
        casesTotal: values.casesTotal,
      })
      .returning();
    if (!row) throw new Error('insert into eval_suite_runs returned no row');
    return row;
  }

  /** Patch a suite run (finish with metrics, or mark failed). */
  async patchSuiteRun(
    suiteRunId: string,
    patch: {
      status: EvalSuiteRunStatus;
      finishedAt?: Date;
      casesPassed?: number;
      recall?: number | null;
      precision?: number | null;
      citationAccuracy?: number | null;
      findingsKept?: number;
      findingsDropped?: number;
      durationMs?: number;
      costUsd?: number | null;
      error?: string | null;
    },
  ): Promise<void> {
    await this.db
      .update(t.evalSuiteRuns)
      .set({
        status: patch.status,
        ...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
        ...(patch.casesPassed !== undefined ? { casesPassed: patch.casesPassed } : {}),
        ...(patch.recall !== undefined ? { recall: patch.recall } : {}),
        ...(patch.precision !== undefined ? { precision: patch.precision } : {}),
        ...(patch.citationAccuracy !== undefined ? { citationAccuracy: patch.citationAccuracy } : {}),
        ...(patch.findingsKept !== undefined ? { findingsKept: patch.findingsKept } : {}),
        ...(patch.findingsDropped !== undefined ? { findingsDropped: patch.findingsDropped } : {}),
        ...(patch.durationMs !== undefined ? { durationMs: patch.durationMs } : {}),
        ...(patch.costUsd !== undefined ? { costUsd: patch.costUsd } : {}),
        ...(patch.error !== undefined ? { error: patch.error } : {}),
      })
      .where(eq(t.evalSuiteRuns.id, suiteRunId));
  }

  /** Get a suite run by id. */
  async getSuiteRun(suiteRunId: string): Promise<EvalSuiteRun | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalSuiteRuns)
      .where(eq(t.evalSuiteRuns.id, suiteRunId));
    if (!row) return undefined;
    return rowToEvalSuiteRun(row);
  }

  /**
   * Recent suite runs for an owner, filtered to `scope = 'suite'` so
   * single-case debug runs never enter trends or aggregates (criterion 16).
   */
  async listSuiteRunsForOwner(ownerId: string, limit = 20): Promise<EvalSuiteRun[]> {
    const rows = await this.db
      .select()
      .from(t.evalSuiteRuns)
      .where(and(eq(t.evalSuiteRuns.ownerId, ownerId), eq(t.evalSuiteRuns.scope, 'suite')))
      .orderBy(desc(t.evalSuiteRuns.ranAt))
      .limit(limit);
    return rows.map(rowToEvalSuiteRun);
  }

  // ---- eval_runs (per-case rows) -------------------------------------------

  /** Insert one per-case run row, recording which suite run it belongs to. */
  async insertEvalRun(values: {
    caseId: string;
    suiteRunId: string;
    pass: boolean | null;
    recall: number | null;
    precision: number | null;
    citationAccuracy: number | null;
    durationMs: number;
    costUsd: number | null;
    findingsKept: number;
    findingsDropped: number;
    caseRevision: number;
    violations: EvalRunRecord['violations'];
    actualOutput: unknown;
  }): Promise<EvalRunRow> {
    const [row] = await this.db
      .insert(t.evalRuns)
      .values({
        caseId: values.caseId,
        suiteRunId: values.suiteRunId,
        pass: values.pass,
        recall: values.recall,
        precision: values.precision,
        citationAccuracy: values.citationAccuracy,
        durationMs: values.durationMs,
        costUsd: values.costUsd,
        findingsKept: values.findingsKept,
        findingsDropped: values.findingsDropped,
        caseRevision: values.caseRevision,
        violations: values.violations as object[],
        actualOutput: values.actualOutput as object,
      })
      .returning();
    if (!row) throw new Error('insert into eval_runs returned no row');
    return row;
  }

  /** Get all per-case run rows for a suite run. */
  async listRunsForSuiteRun(suiteRunId: string): Promise<EvalRunRecord[]> {
    const rows = await this.db
      .select()
      .from(t.evalRuns)
      .where(eq(t.evalRuns.suiteRunId, suiteRunId))
      .orderBy(t.evalRuns.ranAt);
    return rows.map(rowToEvalRunRecord);
  }

  /** Get a single eval run by id. */
  async getEvalRun(suiteRunId: string): Promise<EvalSuiteRun | undefined> {
    return this.getSuiteRun(suiteRunId);
  }

  // ---- Dashboard aggregation ------------------------------------------------

  /**
   * Dashboard aggregate for an owner: recent runs (scope='suite' only) and
   * trend points. Filtering scope keeps single-case debug runs out of the
   * metrics (criterion 16).
   */
  async getDashboard(ownerId: string): Promise<{
    suiteRuns: EvalSuiteRun[];
    caseCount: number;
  }> {
    const [suiteRuns, cases] = await Promise.all([
      this.listSuiteRunsForOwner(ownerId),
      this.db.select({ id: t.evalCases.id }).from(t.evalCases).where(eq(t.evalCases.ownerId, ownerId)),
    ]);
    return { suiteRuns, caseCount: cases.length };
  }

  // ---- Global dashboard (all-agents index) ----------------------------------

  /**
   * All-agents eval index for a workspace (`GET /eval/dashboard`).
   *
   * Returns one `EvalAgentIndexRow` per agent that has at least one eval case,
   * plus a cross-agent recent-runs list (scope='suite', newest first, criterion 16).
   *
   * Metrics are pulled from the agent's most recent `succeeded` suite run.
   * Agents with no succeeded runs have null metrics — never coerced to 0
   * (Recommendation 2 / spec criterion: empty denominator → null).
   */
  async getGlobalDashboard(
    workspaceId: string,
    limit = 20,
  ): Promise<{ agents: EvalAgentIndexRow[]; recentRuns: EvalSuiteRun[] }> {
    // All scope='suite' runs for the workspace, newest first.
    const allRuns = await this.db
      .select()
      .from(t.evalSuiteRuns)
      .where(
        and(
          eq(t.evalSuiteRuns.workspaceId, workspaceId),
          eq(t.evalSuiteRuns.scope, 'suite'),
        ),
      )
      .orderBy(desc(t.evalSuiteRuns.ranAt))
      .limit(200); // reasonable cap; avoids unbounded scan

    // recent_runs: top N across all agents
    const recentRuns = allRuns.slice(0, limit).map(rowToEvalSuiteRun);

    // Agents with cases in this workspace (join agents table to get name).
    const agentRows = await this.db
      .selectDistinct({ agentId: t.evalCases.ownerId, agentName: t.agents.name })
      .from(t.evalCases)
      .innerJoin(t.agents, eq(t.agents.id, t.evalCases.ownerId))
      .where(eq(t.evalCases.workspaceId, workspaceId));

    const agents: EvalAgentIndexRow[] = agentRows.map((ar) => {
      const agentRuns = allRuns.filter((r) => r.ownerId === ar.agentId);
      const succeeded = agentRuns.filter((r) => r.status === 'succeeded');
      const latest = succeeded[0]; // newest first

      // Sparkline: recall from last 8 succeeded runs, chronological.
      const sparkline = succeeded
        .slice(0, 8)
        .reverse()
        .map((r) => r.recall);

      return {
        agent_id: ar.agentId,
        agent_name: ar.agentName,
        recall: latest?.recall ?? null,
        precision: latest?.precision ?? null,
        citation_accuracy: latest?.citationAccuracy ?? null,
        cases_passed: latest?.casesPassed ?? 0,
        cases_total: latest?.casesTotal ?? 0,
        sparkline,
        last_run_at: agentRuns[0]?.ranAt?.toISOString() ?? null,
      };
    });

    return { agents, recentRuns };
  }

  // ---- Boot reaper ----------------------------------------------------------

  /**
   * Reap `eval_suite_runs` rows left in `status = 'running'` by a crashed
   * process. Mirrors `reapStaleRunningRuns()` in the reviews repository.
   * Called once on boot (awaited before listening) so stale rows don't show
   * as perpetually "running" in the UI (criterion 17).
   */
  async reapStaleSuiteRuns(): Promise<number> {
    // A run left running from a previous process must be at least 60s old
    // to distinguish it from a run that JUST started in this process.
    const cutoff = new Date(Date.now() - 60_000);
    const rows = await this.db
      .update(t.evalSuiteRuns)
      .set({ status: 'failed', error: 'Process was killed while this run was in progress' })
      .where(and(eq(t.evalSuiteRuns.status, 'running'), lt(t.evalSuiteRuns.ranAt, cutoff)))
      .returning({ id: t.evalSuiteRuns.id });
    return rows.length;
  }
}
