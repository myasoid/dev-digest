/**
 * scoring.ts — pure, hermetic eval scorer.
 *
 * No DB, no LLM, no imports from platform/, db/, or reviewer-core/ beyond types.
 * All inputs are plain values; all outputs are numbers or null.
 *
 * RULES (verbatim from spec §Scoring):
 *   Match rule — ONLY file equality + inclusive non-empty line-range intersection.
 *   title/severity/category NEVER matched.
 *   Each finding resolves against AT MOST ONE target; must_not_flag wins over must_find.
 *   TP = grounded findings matching ≥1 must_find target (1 finding spanning 3 targets = 1 TP).
 *   FN = must_find targets no finding matched.
 *   FP = findings hitting must_not_flag OR unmatched in a 'forbid' case.
 *   recall     = matched must_find targets / all must_find targets      (null if no must_find)
 *   precision  = TP / (TP + FP)                                         (null if TP+FP==0)
 *   citation_accuracy = Σkept / Σ(kept+dropped)                         (null if Σ(kept+dropped)==0)
 *   A case passes when every must_find matched AND zero FP.
 *   Empty denominators → null, never 0.
 */

import type { Finding } from '../../vendor/shared/contracts/findings.js';
import type { EvalTarget, EvalViolation, EvalUnlistedPolicy } from '../../vendor/shared/contracts/eval-run.js';

// ---------------------------------------------------------------------------
// Internal types — keep the surface minimal; the scorer is pure functions only
// ---------------------------------------------------------------------------

/** A single case ready to score: the frozen targets and the policy. */
export interface ScoringCase {
  targets: EvalTarget[];
  unlisted: EvalUnlistedPolicy;
  /** Findings that survived the grounding gate (ReviewOutcome.review.findings). */
  findings: Finding[];
  /** Findings dropped by the grounding gate (ReviewOutcome.dropped.map(d => d.finding)). */
  dropped: Finding[];
}

/** Per-case result. */
export interface CaseScore {
  pass: boolean;
  /** TP count for this case — findings that matched a must_find target. */
  tp: number;
  /** FP count for this case. */
  fp: number;
  /**
   * must_find targets matched by at least one finding.
   * recall_num / recall_den per case contribute to the set-level recall.
   */
  recall_num: number;
  recall_den: number;
  /** Violations (FP details) — must_not_flag hits and unlisted-forbid hits. */
  violations: EvalViolation[];
  /** must_find targets that no finding matched. */
  missed: EvalTarget[];
}

/** Set-level result across all cases. */
export interface SetScore {
  cases_passed: number;
  cases_total: number;
  /** null when no must_find targets exist across the set. */
  recall: number | null;
  /** null when TP + FP === 0 across the set. */
  precision: number | null;
  /**
   * null when Σ(kept + dropped) === 0 across the set.
   * Computed from the citation inputs, not from per-case scores.
   */
  citation_accuracy: number | null;
  /** Per-case results — same order as the input cases array. */
  per_case: CaseScore[];
}

// ---------------------------------------------------------------------------
// Core primitives
// ---------------------------------------------------------------------------

/**
 * Returns true when the two [lo, hi] ranges have a non-empty intersection,
 * i.e. when they overlap on at least one line (inclusive on both ends).
 *
 * Adjacent-by-one (e.g. [1,5] and [6,10]) do NOT intersect — they touch but
 * share zero lines.
 */
export function linesIntersect(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Returns true when finding `f` matches target `t` under the spec's sole
 * match rule: file equality AND inclusive non-empty line-range intersection.
 *
 * title/severity/category are deliberately not consulted.
 */
export function findingMatchesTarget(f: Finding, t: EvalTarget): boolean {
  return f.file === t.file && linesIntersect(f.start_line, f.end_line, t.start_line, t.end_line);
}

// ---------------------------------------------------------------------------
// Per-case scorer
// ---------------------------------------------------------------------------

/**
 * Score one eval case. Returns per-case metrics and the lists needed for the
 * run detail view (violations, missed).
 *
 * Resolve-against-at-most-one-target precedence:
 *   1. must_not_flag  — a range the user said NOT to flag is a stronger, more
 *      recent statement than a must_find for the same range.
 *   2. must_find      — only after confirming the finding hits no must_not_flag.
 *
 * A finding that matches BOTH kinds is resolved as must_not_flag (FP), never
 * as TP — scoring it as a hit would let an agent earn recall for producing
 * exactly the noise that was dismissed.
 */
export function scoreCase(c: ScoringCase): CaseScore {
  const mustFindTargets = c.targets.filter((t) => t.kind === 'must_find');
  const mustNotFlagTargets = c.targets.filter((t) => t.kind === 'must_not_flag');

  // Track which must_find targets were matched (at most once each).
  const matchedMustFind = new Set<EvalTarget>();
  // Track which findings were resolved (to avoid double-counting).
  // Value: 'tp' | 'fp'
  const findingResolution = new Map<Finding, 'tp' | 'fp'>();

  const violations: EvalViolation[] = [];

  for (const f of c.findings) {
    // Step 1: check must_not_flag first — it wins over must_find.
    // A range the user explicitly said not to flag is a stronger, more recent
    // statement than a must_find for the same range.
    const mntfHit = mustNotFlagTargets.find((t) => findingMatchesTarget(f, t));
    if (mntfHit) {
      findingResolution.set(f, 'fp');
      violations.push({ reason: 'must_not_flag', finding: f, target: mntfHit });
      continue;
    }

    // Step 2: check must_find — a finding can span MULTIPLE targets.
    // "One finding spanning three targets counts as ONE TP" (spec), but
    // all three matched targets should be recorded so recall_num is correct.
    const mfHits = mustFindTargets.filter((t) => findingMatchesTarget(f, t));
    if (mfHits.length > 0) {
      findingResolution.set(f, 'tp');
      for (const hit of mfHits) {
        matchedMustFind.add(hit);
      }
      continue;
    }

    // Step 3: no match — apply the unlisted policy.
    if (c.unlisted === 'forbid') {
      findingResolution.set(f, 'fp');
      violations.push({ reason: 'unlisted', finding: f, target: null });
    }
    // Under 'ignore' (default): extra findings are not held against the agent.
  }

  const tp = [...findingResolution.values()].filter((v) => v === 'tp').length;
  const fp = [...findingResolution.values()].filter((v) => v === 'fp').length;

  const recall_num = matchedMustFind.size;
  const recall_den = mustFindTargets.length;

  const missed = mustFindTargets.filter((t) => !matchedMustFind.has(t));

  // A case passes: every must_find matched AND zero FP.
  const pass = missed.length === 0 && fp === 0;

  return { pass, tp, fp, recall_num, recall_den, violations, missed };
}

// ---------------------------------------------------------------------------
// Citation accuracy input
// ---------------------------------------------------------------------------

export interface CitationInput {
  kept: number;
  dropped: number;
}

// ---------------------------------------------------------------------------
// Set-level scorer
// ---------------------------------------------------------------------------

/**
 * Aggregate per-case scores into set-level metrics.
 *
 * Empty denominators MUST return null, never 0:
 *   - recall     → null when no must_find targets exist across the set.
 *   - precision  → null when TP + FP === 0 (no findings resolved to either).
 *   - citation_accuracy → null when Σ(kept + dropped) === 0.
 */
export function scoreSet(
  caseScores: CaseScore[],
  citationInputs: CitationInput[],
): SetScore {
  let totalTp = 0;
  let totalFp = 0;
  let totalRecallNum = 0;
  let totalRecallDen = 0;
  let casesPassed = 0;

  for (const cs of caseScores) {
    totalTp += cs.tp;
    totalFp += cs.fp;
    totalRecallNum += cs.recall_num;
    totalRecallDen += cs.recall_den;
    if (cs.pass) casesPassed++;
  }

  const recall = totalRecallDen === 0 ? null : totalRecallNum / totalRecallDen;
  const precision = totalTp + totalFp === 0 ? null : totalTp / (totalTp + totalFp);

  let totalKept = 0;
  let totalKeptPlusDropped = 0;
  for (const ci of citationInputs) {
    totalKept += ci.kept;
    totalKeptPlusDropped += ci.kept + ci.dropped;
  }
  const citation_accuracy = totalKeptPlusDropped === 0 ? null : totalKept / totalKeptPlusDropped;

  return {
    cases_passed: casesPassed,
    cases_total: caseScores.length,
    recall,
    precision,
    citation_accuracy,
    per_case: caseScores,
  };
}

// ---------------------------------------------------------------------------
// Convenience: score a full set in one call
// ---------------------------------------------------------------------------

/**
 * Score a list of cases and produce the set-level metrics.
 *
 * `citationInputs[i]` must correspond to `cases[i]`.
 */
export function scoreCases(cases: ScoringCase[], citationInputs: CitationInput[]): SetScore {
  const perCase = cases.map(scoreCase);
  return scoreSet(perCase, citationInputs);
}
