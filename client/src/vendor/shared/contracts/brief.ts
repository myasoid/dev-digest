import { z } from 'zod';
import { Severity } from './findings.js';

/**
 * PR Brief building blocks: Intent, Smart Diff, and the PR Brief card itself
 * (SPEC-cross-06).
 *
 * `BlastRadius`/`Risks`/`PrHistory` (an earlier, heavier "PR Brief" concept —
 * `{ intent, blast, risks, history }`) were removed 2026-08-27 when `PrBrief`
 * was repurposed to the new card shape below: grep confirmed zero importers
 * outside this file, and the current blast-summary view lives in
 * `contracts/pr-blast.ts`'s `PrBlastMap` instead.
 */

// ---- Intent ----
/**
 * How the classifier arrived at `intent`/`in_scope`/`out_of_scope`:
 * 'high' — an explicit PR description AND a resolved plan/spec/ticket
 * reference were used; 'medium' — an explicit description but no resolved
 * reference; 'low' — only indirect signals (files touched, commit messages,
 * branch name, diff shape) were available. Set by the classifier's own logic,
 * never self-reported by the model (see reviewer-core/INSIGHTS.md — a
 * self-reported confidence is not verifiable).
 */
export const IntentConfidence = z.enum(['high', 'medium', 'low']);
export type IntentConfidence = z.infer<typeof IntentConfidence>;

export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  /** Defaulted so pre-existing `pr_intent` rows / PrBrief documents (written
   * before this field existed) still parse as 'high' — their behaviour is
   * unchanged, since nothing read this field before. */
  confidence: IntentConfidence.default('high'),
  /** Human-readable list of what was actually used to classify, e.g.
   * `["title", "body", "resolved:specs/rate-limiting.md"]` or
   * `["branch_name", "commit_messages", "file_list"]`. */
  signals_used: z.array(z.string()).default([]),
  /**
   * Consolidated "risk area" signals — CRITICAL findings that landed outside
   * the PR's declared `out_of_scope`, demoted from a full blocking finding
   * into a short summary string instead of being dropped entirely. Computed
   * deterministically by reviewer-core AFTER a review runs (never by this
   * classifier), so it is empty until the first review completes.
   */
  risk_areas: z.array(z.string()).default([]),
  /**
   * The PR's head SHA at classification time. Lets a consumer detect that new
   * commits landed since this intent was cached (staleness) without a second
   * DB round trip. Nullish for rows written before this field existed.
   */
  head_sha: z.string().nullish(),
});
export type Intent = z.infer<typeof Intent>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'wiring', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

/**
 * One finding's line + severity, for the file's badge — enough for the client
 * to render "N findings" plus a severity chip WITHOUT a cross-reference into
 * `usePrReviews`. Reuses the existing `Severity` enum (CRITICAL/WARNING/
 * SUGGESTION) rather than inventing a Smart-Diff-local one.
 */
export const SmartDiffFinding = z.object({
  line: z.number().int(),
  severity: Severity,
});
export type SmartDiffFinding = z.infer<typeof SmartDiffFinding>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  findings: z.array(SmartDiffFinding),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- PR Brief card (SPEC-cross-06, pr_brief.json) ----
/**
 * PR-level risk scale — distinct from `Verdict` (an action: request_changes/
 * approve/comment) and `Severity` (per-finding: CRITICAL/WARNING/SUGGESTION).
 */
export const RiskLevel = z.enum(['high', 'medium', 'low']);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const BriefRisk = z.object({
  title: z.string(),
  explanation: z.string(),
  /** File paths / endpoint labels this risk points at — MUST be a subset of
   *  the generation input set (grounding, AC-7). Server-enforced, never
   *  trusted from the model as-is. */
  refs: z.array(z.string()),
});
export type BriefRisk = z.infer<typeof BriefRisk>;

export const BriefFocusItem = z.object({
  /** File path or endpoint label — MUST appear in the input set (grounding,
   *  AC-7). Drives the clickable file:line link. */
  ref: z.string(),
  line: z.number().int().nullable(),
  description: z.string(),
});
export type BriefFocusItem = z.infer<typeof BriefFocusItem>;

/**
 * PR Brief card: one-LLM-call `{ what, why, risk_level, risks[], review_focus[] }`
 * shown at the top of the PR Overview tab. Repurposes the earlier, heavier
 * `PrBrief` concept (`{ intent, blast, risks, history }`) — see the file
 * docstring above. Cached in `pr_brief` (one row per PR, overwritten on
 * regenerate), keyed to `head_sha` for staleness (AC-3, AC-4).
 */
export const PrBrief = z.object({
  what: z.string(),
  why: z.string(),
  risk_level: RiskLevel,
  risks: z.array(BriefRisk),
  review_focus: z.array(BriefFocusItem),
  /** Which inputs were actually present at generation (e.g. `intent`,
   *  `blast`, `issue`, `specs`, `diff_shape`) — drives the partial indicator
   *  (AC-13). Server-set from what was actually used, never model-reported. */
  signals_used: z.array(z.string()),
  /** Head SHA the brief was generated against — cache key + file:line pin +
   *  staleness (AC-3, AC-4, AC-9). Nullish for rows written before this
   *  field existed, mirroring `Intent.head_sha`. */
  head_sha: z.string().nullish(),
});
export type PrBrief = z.infer<typeof PrBrief>;
