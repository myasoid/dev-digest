import { z } from 'zod';

/**
 * Independent Zod schemas mirroring the JSON shapes the DevDigest API
 * returns. Deliberately NOT imported from `@devdigest/shared` — this package
 * has no `vendor/shared` copy and no `check-contracts.sh` coverage, so a
 * third vendored copy would drift silently. See `mcp-server/specs/development-plan.md`
 * ("Architecture note") and `README.md`.
 *
 * Field-level detail (units, casing, what null means, etc.) lives in each
 * field's `.describe()` here — the tool `description` strings in
 * `src/server.ts` stay high-level per the plan's "Tool specifications".
 */

// ---- list_agents ----------------------------------------------------------

export const AgentSummary = z.object({
  id: z.string().describe(
    'Stable identifier for this agent. Pass this (or the name) as the `agent` argument to run_agent_on_pr.',
  ),
  name: z.string().describe('Human-readable, workspace-unique agent name.'),
  description: z.string().describe('What this agent focuses on when reviewing a pull request.'),
  model: z.string().describe('LLM model id the agent runs on, e.g. "claude-sonnet-4-5" or "gpt-4.1".'),
  enabled: z
    .boolean()
    .describe('Whether the agent can currently be run. Disabled agents are listed but run_agent_on_pr will fail for them.'),
});
export type AgentSummary = z.infer<typeof AgentSummary>;

export const ListAgentsOutput = z.object({
  agents: z.array(AgentSummary).describe('Every reviewer agent configured in this workspace, enabled or not.'),
});
export type ListAgentsOutput = z.infer<typeof ListAgentsOutput>;

// ---- run_agent_on_pr / get_findings ----------------------------------------

export const Severity = z.enum(['CRITICAL', 'WARNING', 'SUGGESTION']).describe(
  'Impact level of the finding, worst first: CRITICAL blocks merge, WARNING should be addressed, SUGGESTION is optional polish.',
);
export type Severity = z.infer<typeof Severity>;

export const FindingCategory = z.enum(['bug', 'security', 'perf', 'style', 'test']).describe(
  'What kind of issue this is.',
);
export type FindingCategory = z.infer<typeof FindingCategory>;

export const Verdict = z.enum(['request_changes', 'approve', 'comment']).describe(
  'Overall recommendation for the pull request.',
);
export type Verdict = z.infer<typeof Verdict>;

export const FindingSummary = z.object({
  severity: Severity,
  category: FindingCategory,
  title: z.string().describe('One-line summary of the finding.'),
  file: z.string().describe('Repo-relative path of the affected file.'),
  start_line: z.number().int().describe('1-based first line of the affected range.'),
  end_line: z.number().int().describe('1-based last line of the affected range (inclusive).'),
  rationale: z.string().describe('Why this is a problem, in markdown.'),
});
export type FindingSummary = z.infer<typeof FindingSummary>;

export const ReviewResult = z.object({
  verdict: Verdict.nullable().describe('Null when no completed review exists yet (e.g. a poll timeout).'),
  score: z
    .number()
    .int()
    .min(0)
    .max(100)
    .nullable()
    .describe('Overall PR quality from 0-100, higher is better. Null when no completed review exists yet.'),
  summary: z.string().nullable().describe('Prose summary of the review. Null when no completed review exists yet.'),
  findings: z
    .array(FindingSummary)
    .describe('Individual issues found, in the order the server returned them. Empty when there are none (or none yet).'),
});
export type ReviewResult = z.infer<typeof ReviewResult>;

// ---- get_conventions --------------------------------------------------------

export const ConventionCandidateSummary = z.object({
  category: z.string().describe('Free-text label for the kind of convention, e.g. "naming", "error-handling".'),
  rule: z.string().describe('The convention itself, stated as prose.'),
  evidence_path: z.string().describe('Repo-relative path of the file the rule was extracted from.'),
  evidence_start_line: z.number().int().describe('1-based first line of the evidence excerpt.'),
  evidence_end_line: z.number().int().describe('1-based last line of the evidence excerpt (inclusive).'),
  confidence: z.number().min(0).max(1).describe('Model confidence in this candidate, from 0 to 1.'),
  accepted: z.boolean().describe('Whether a human has accepted this candidate as a real, enforced convention.'),
});
export type ConventionCandidateSummary = z.infer<typeof ConventionCandidateSummary>;

export const GetConventionsOutput = z.object({
  scanned_at: z
    .string()
    .nullable()
    .describe('ISO timestamp of the last convention-extraction run for this repo; null if it has never been scanned.'),
  candidates: z.array(ConventionCandidateSummary).describe('Detected convention candidates, accepted and pending.'),
});
export type GetConventionsOutput = z.infer<typeof GetConventionsOutput>;

// ---- run status (internal — feeds the run-poller, not a tool output itself) ---

export const RunStatusSummary = z.object({
  run_id: z.string(),
  agent_id: z.string().nullable(),
  agent_name: z.string().nullable(),
  status: z.string().nullable().describe('running | done | failed | cancelled'),
  error: z.string().nullable().describe('Failure reason; set only when status is "failed".'),
});
export type RunStatusSummary = z.infer<typeof RunStatusSummary>;

// ---- get_blast_radius (mirrors @devdigest/shared BlastResult / PrBlastMap;
// kept as independent copies per the architecture note above — no vendor/shared
// copy here, no check-contracts.sh coverage for this package) ---------------

export const DegradedReason = z
  .enum(['flag_off', 'index_failed', 'index_partial', 'repo_too_large', 'no_data'])
  .describe('Why the result is degraded. Only present when degraded is true.');
export type DegradedReason = z.infer<typeof DegradedReason>;

export const BlastChangedSymbol = z.object({
  file: z.string().describe('Repo-relative path where the changed symbol is defined.'),
  name: z.string().describe('Symbol name (function, class, method, etc).'),
  kind: z.string().describe('Symbol kind, e.g. "function", "class", "method".'),
});
export type BlastChangedSymbol = z.infer<typeof BlastChangedSymbol>;

export const BlastCallerRow = z.object({
  file: z.string().describe('Repo-relative path of the calling file.'),
  symbol: z.string().describe('Name of the calling symbol.'),
  viaSymbol: z.string().describe('Which changed symbol this caller reaches.'),
  line: z.number().int().describe('1-based line of the call reference.'),
  rank: z.number().describe('Importance rank of the caller file; 0 on the degraded/ripgrep fallback path.'),
});
export type BlastCallerRow = z.infer<typeof BlastCallerRow>;

export const BlastFileFacts = z.object({
  endpoints: z.array(z.string()).describe('"METHOD /path" endpoints attributable to this caller file.'),
  crons: z.array(z.string()).describe('Cron job names attributable to this caller file.'),
});
export type BlastFileFacts = z.infer<typeof BlastFileFacts>;

export const BlastRadiusOutput = z.object({
  changedSymbols: z.array(BlastChangedSymbol).describe('Symbols touched by the given changed_files.'),
  callers: z.array(BlastCallerRow).describe('Call sites that reach one of changedSymbols.'),
  impactedEndpoints: z
    .array(z.string())
    .describe('"METHOD /path" endpoints impacted by the change, flattened across all callers.'),
  factsByFile: z
    .record(z.string(), BlastFileFacts)
    .optional()
    .describe('Per-caller-file endpoints/crons. Present only on the fully-indexed (non-degraded) path.'),
  degraded: z
    .boolean()
    .optional()
    .describe('True when the repo is not fully indexed, so callers/impactedEndpoints may be incomplete.'),
  reason: DegradedReason.optional(),
});
export type BlastRadiusOutput = z.infer<typeof BlastRadiusOutput>;

// ---- PrBlastMap — GET /pulls/:id/blast (Phase 3) ---------------------------
// Mirrors @devdigest/shared contracts/pr-blast.ts. Kept as an independent copy.

export const BlastStatus = z
  .enum(['ok', 'partial', 'degraded'])
  .describe(
    'ok = complete index, no staleness, no caps; partial = stale index, partial index, or a cap was hit; degraded = no index at all.',
  );
export type BlastStatus = z.infer<typeof BlastStatus>;

export const PrBlastSymbol = z.object({
  file: z.string().describe('Repo-relative path where the changed symbol is defined.'),
  name: z.string().describe('Symbol name.'),
  kind: z.string().describe('Symbol kind, e.g. "function", "class".'),
  callers: z.array(BlastCallerRow).describe('Call sites that reference this symbol (capped at 20 per symbol).'),
  callerCount: z
    .number()
    .int()
    .describe('Total callers before the per-symbol cap; exact even when truncated is true.'),
  truncated: z.boolean().describe('True when callers was capped at MAX_CALLERS_PER_SYMBOL.'),
});
export type PrBlastSymbol = z.infer<typeof PrBlastSymbol>;

export const PrBlastTarget = z.object({
  label: z.string().describe('"METHOD /path" (endpoint) or cron expression / job name.'),
  viaFiles: z.array(z.string()).describe('Files through which this target was reached.'),
  depth: z
    .union([z.literal(1), z.literal(2)])
    .describe('Traversal depth: 1 = direct caller file, 2 = file that imports a caller file.'),
});
export type PrBlastTarget = z.infer<typeof PrBlastTarget>;

export const PriorPrSummary = z.object({
  number: z.number().int().describe('GitHub PR number.'),
  title: z.string().describe('PR title.'),
  url: z.string().describe('GitHub PR URL (https://github.com/{owner}/{name}/pull/{number}).'),
  sharedFiles: z.array(z.string()).describe('Files this PR and the target PR both touched.'),
});
export type PriorPrSummary = z.infer<typeof PriorPrSummary>;

export const PrBlastMap = z.object({
  status: BlastStatus,
  explanation: z
    .string()
    .nullable()
    .describe(
      'Non-null when status is not "ok". Plain prose describing which condition fired (stale index, partial index, cap hit, or degraded). Surface this to the reviewer whenever non-null.',
    ),
  reason: DegradedReason.nullable().describe('Why the result is degraded; null when status is not "degraded".'),
  indexedSha: z
    .string()
    .nullable()
    .describe('The commit SHA the index was built at — file:line links are pinned to this SHA.'),
  stale: z.boolean().describe('True when indexedSha differs from the PR head_sha.'),
  symbols: z.array(PrBlastSymbol).describe('Changed symbols, each with their capped caller list.'),
  symbolsTruncated: z.boolean().describe('True when the changed-symbol list was capped at 50.'),
  endpoints: z
    .array(PrBlastTarget)
    .describe('HTTP endpoints reachable from changed symbols at depth 1 or 2.'),
  crons: z
    .array(PrBlastTarget)
    .describe('Scheduled jobs reachable from changed symbols at depth 1 or 2.'),
  priorPrs: z
    .array(PriorPrSummary)
    .describe('Up to 5 prior PRs in the same repo that touched at least one of the same files, ranked by shared-file count.'),
  counts: z.object({
    symbols: z.number().int(),
    callers: z.number().int(),
    endpoints: z.number().int(),
    crons: z.number().int(),
  }).describe('Post-cap counts reflecting exactly what is returned in this response.'),
});
export type PrBlastMap = z.infer<typeof PrBlastMap>;
