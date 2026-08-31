import { z } from 'zod';
import { Severity, FindingCategory, Finding } from './findings.js';

/**
 * Eval pipeline — run-level contracts (Phase 1).
 *
 * New shapes needed to express eval suite runs: target assertions with explicit
 * kinds, the unlisted-finding policy, and the aggregate suite-run record. These
 * EXTEND the barrel; they do not modify the existing `EvalRun` / `EvalCase`
 * shapes in `knowledge.ts` (those stay as-is — `EvalRun` is a per-execution
 * metrics shape, not a suite shape).
 *
 * IMPORT DIRECTION — this file must NOT import from `knowledge.ts`.
 * `knowledge.ts` imports `EvalTarget`/`EvalUnlistedPolicy`/`EvalOwnerKind` from
 * here, so an import back the other way is a cycle. Zod schemas are runtime
 * *values*, so a contract cycle is not a type error — `tsc --noEmit` and the
 * vitest suites all stay green and the server dies at boot with
 * `ReferenceError: Cannot access 'X' before initialization`. `EvalOwnerKind`
 * lives here for exactly that reason; it was moved out of `knowledge.ts`.
 */

// ---------------------------------------------------------------------------
// Owner kind — defined here (not in knowledge.ts) to keep the import acyclic
// ---------------------------------------------------------------------------

export const EvalOwnerKind = z.enum(['skill', 'agent']);
export type EvalOwnerKind = z.infer<typeof EvalOwnerKind>;

// ---------------------------------------------------------------------------
// Target assertion — the kind lives here, not on the case (spec gap 2)
// ---------------------------------------------------------------------------

export const EvalExpectationKind = z.enum(['must_find', 'must_not_flag']);
export type EvalExpectationKind = z.infer<typeof EvalExpectationKind>;

/**
 * One assertion about one place in the case's diff.
 *
 * The KIND lives here, not on the case — a single frozen diff routinely
 * carries both kinds (e.g. one accepted finding and one dismissed finding on
 * the same PR). Display fields (`severity`, `category`, `title`) are stored
 * for readability and provenance ONLY; they are NEVER matched on by the scorer.
 */
export const EvalTarget = z.object({
  kind: EvalExpectationKind,
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  /** The finding this target was minted from. Null once that finding is gone. */
  source_finding_id: z.string().nullable(),
  /** Display + provenance only — scorer ignores these. */
  severity: Severity.nullish(),
  category: FindingCategory.nullish(),
  title: z.string().nullish(),
});
export type EvalTarget = z.infer<typeof EvalTarget>;

// ---------------------------------------------------------------------------
// Unlisted-finding policy
// ---------------------------------------------------------------------------

/**
 * What to do with a grounded finding that matches NO target.
 *   'ignore'  — default. An extra finding is not held against the agent.
 *   'forbid'  — every unmatched finding is a false positive. With zero
 *               targets this is the whole-diff negative control (the mockup's
 *               `clean-refactor-no-flags`); with `must_find` targets it is
 *               strict mode.
 */
export const EvalUnlistedPolicy = z.enum(['ignore', 'forbid']);
export type EvalUnlistedPolicy = z.infer<typeof EvalUnlistedPolicy>;

// ---------------------------------------------------------------------------
// Suite-run status and scope
// ---------------------------------------------------------------------------

export const EvalSuiteRunStatus = z.enum(['running', 'succeeded', 'failed', 'cancelled']);
export type EvalSuiteRunStatus = z.infer<typeof EvalSuiteRunStatus>;

/** 'case' = one-case debug run. Excluded from trends and aggregates. */
export const EvalRunScope = z.enum(['suite', 'case']);
export type EvalRunScope = z.infer<typeof EvalRunScope>;

// ---------------------------------------------------------------------------
// Run inputs — everything that determined a run's output (gap 5 fix)
// ---------------------------------------------------------------------------

/**
 * Everything that determined a run's output. Comparability is computed from
 * this triple, not assumed — gap 5's fix. Two runs with different triples
 * cannot be presented as a like-for-like comparison.
 */
export const EvalRunInputs = z.object({
  /** `agents.version` at run start — the "v6/v7" label. */
  agent_version: z.number().int(),
  /**
   * The skill BODIES that ran, pinned by version at run start. Storing ids
   * alone (the way `agent_versions.config_json.skills` does) makes a skill
   * body edit invisible between two runs stamped with the same agent version —
   * gap 5's second leak.
   */
  skill_versions: z.array(
    z.object({ skill_id: z.string(), version: z.number().int() }),
  ),
  /**
   * Fingerprint over the set's (case_id, revision) pairs — changes whenever
   * any case's measurement-affecting fields change (gap 6). The trend chart
   * breaks its line at this boundary.
   */
  case_set_revision: z.string(),
});
export type EvalRunInputs = z.infer<typeof EvalRunInputs>;

// ---------------------------------------------------------------------------
// Violation — a false positive that the scorer can name and locate
// ---------------------------------------------------------------------------

/**
 * A false-positive violation: a grounded finding that either hit a
 * `must_not_flag` target or was unmatched in a `forbid`-policy case.
 *
 * Violations are reported SEPARATELY from misses (`EvalRunRecord.missed`) so
 * that a false negative (a missed must_find) and a false positive are never
 * folded into one list under one label — the distinction is precisely what
 * the scorer exists to draw.
 */
export const EvalViolation = z.object({
  reason: z.enum(['must_not_flag', 'unlisted']),
  /** The offending finding — always present; this is the "what happened". */
  finding: Finding,
  /** The `must_not_flag` target it hit. Null when `reason` is 'unlisted'. */
  target: EvalTarget.nullable(),
});
export type EvalViolation = z.infer<typeof EvalViolation>;

// ---------------------------------------------------------------------------
// Suite-run aggregate — the set-level run record (gap 1 fix)
// ---------------------------------------------------------------------------

/**
 * One complete run of the full eval set (or a single debug case). This is
 * what populates `EvalDashboard.recent_runs` and the RECENT RUNS table in
 * the dashboard. It replaces `EvalRunRecord` in that context.
 *
 * `recall`, `precision`, `citation_accuracy` are nullable — empty denominators
 * MUST return `null`, never `0`. A set of only negative controls has no
 * `must_find` targets; scoring it `recall: 0` would render as a catastrophe
 * in the exact case where the agent did everything right.
 */
export const EvalSuiteRun = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  inputs: EvalRunInputs,
  scope: EvalRunScope,
  status: EvalSuiteRunStatus,
  ran_at: z.string(),
  finished_at: z.string().nullable(),
  cases_total: z.number().int(),
  cases_passed: z.number().int(),
  /** null, never 0, when the denominator was empty. */
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  findings_kept: z.number().int(),
  findings_dropped: z.number().int(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  error: z.string().nullable(),
});
export type EvalSuiteRun = z.infer<typeof EvalSuiteRun>;

// ---------------------------------------------------------------------------
// All-agents index — one row per agent, plus a cross-agent recent-runs list
// ---------------------------------------------------------------------------

/**
 * One row in the all-agents eval index (`GET /eval/dashboard`).
 *
 * Metrics are nullable — Recommendation 2: an agent with only `must_not_flag`
 * cases has an empty recall denominator; coercing to 0 would display as a
 * catastrophe when the agent did everything right.
 *
 * The sparkline series (chronological, scope='suite' only) lets the client
 * render a mini trend without a second request. A null entry means that run
 * had an empty denominator for that metric.
 */
export const EvalAgentIndexRow = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  /** Metrics from the agent's most recent succeeded suite run. Null if no run exists. */
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  cases_passed: z.number().int(),
  cases_total: z.number().int(),
  /** Mini sparkline: recall from the last N succeeded suite runs (chronological). */
  sparkline: z.array(z.number().nullable()),
  /** ISO string of the last suite run's ran_at, or null if no runs. */
  last_run_at: z.string().nullable(),
});
export type EvalAgentIndexRow = z.infer<typeof EvalAgentIndexRow>;

/**
 * Response of `GET /eval/dashboard` — the all-agents eval index.
 *
 * Lists agents; does NOT rank them. Cross-agent leaderboards are explicitly
 * out of scope (Step 25). scope='suite' filter enforced server-side — single-
 * case debug runs never appear (criterion 16).
 */
export const EvalGlobalDashboard = z.object({
  agents: z.array(EvalAgentIndexRow),
  /** Recent suite runs across ALL agents, scope='suite', newest first. */
  recent_runs: z.array(EvalSuiteRun),
});
export type EvalGlobalDashboard = z.infer<typeof EvalGlobalDashboard>;

// ---------------------------------------------------------------------------
// Fan-out result — POST /eval/run-all
// ---------------------------------------------------------------------------

/**
 * Immediate response for `POST /eval/run-all` (202).
 *
 * The route fans out sequentially and returns immediately after enqueuing.
 * `queued` is the number of agents whose runs were accepted; `agent_ids` is
 * the ordered list so the client can poll each agent's dashboard row.
 *
 * IMPORT NOTE: this type lives in eval-run.ts (not knowledge.ts) to keep the
 * import graph acyclic — knowledge.ts imports from eval-run.ts, never the
 * reverse.
 */
export const EvalRunAllResult = z.object({
  queued: z.number().int(),
  agent_ids: z.array(z.string()),
});
export type EvalRunAllResult = z.infer<typeof EvalRunAllResult>;
