import { z } from 'zod';

/**
 * Blast radius — the impact map for a set of changed files, computed by
 * `repo-intel`'s `getBlastRadius()` facade method
 * (`server/src/modules/repo-intel/service.ts:220-304`).
 *
 * Promoted from the plain TS types in `repo-intel/types.ts` so the new
 * `POST /repos/:id/blast` route (repo-intel/routes.ts) can declare a real
 * Zod `response` schema, per `server/CLAUDE.md` ("Routes declare Zod
 * params/body/response schemas ... Invalid input is rejected before the
 * handler runs"). `repo-intel/types.ts` re-exports the inferred types below
 * so `RepoIntelService.getBlastRadius()`'s signature needs no change.
 *
 * NOT to be confused with `BlastRadius` in `./brief.ts` — that is an
 * unrelated, already-shipped `PrBrief` summary field (`changed_symbols`,
 * `downstream`, `summary`) with a different shape and a different producer
 * (the PR-brief classifier, not repo-intel). Different contract, same
 * English name; do not merge or rename either one.
 */

// ---- Degraded reason ----
/**
 * Why a `repo-intel` object-returning method fell back to a degraded result
 * instead of a real answer (see `repo-intel/types.ts`'s "DEGRADED CONTRACT"
 * header comment). Mirrors `DegradedReason` in `repo-intel/types.ts:27-32`.
 */
export const DegradedReason = z.enum([
  'flag_off',
  'index_failed',
  'index_partial',
  'repo_too_large',
  'no_data',
]);
export type DegradedReason = z.infer<typeof DegradedReason>;

// ---- Blast radius ----
export const BlastChangedSymbol = z.object({
  file: z.string(),
  name: z.string(),
  kind: z.string(),
});
export type BlastChangedSymbol = z.infer<typeof BlastChangedSymbol>;

export const BlastCallerRow = z.object({
  file: z.string(),
  symbol: z.string(),
  /** Which changed symbol this caller reaches. */
  viaSymbol: z.string(),
  /** 1-based line of the reference (representative; for the BlastRadius view). */
  line: z.number().int(),
  /** `file_rank.rank` of the caller file (0 in the degraded/ripgrep path). */
  rank: z.number(),
});
export type BlastCallerRow = z.infer<typeof BlastCallerRow>;

export const BlastResult = z.object({
  changedSymbols: z.array(BlastChangedSymbol),
  callers: z.array(BlastCallerRow),
  /** "METHOD /path" (via extractEndpoints / file_facts) — flat union. */
  impactedEndpoints: z.array(z.string()),
  /**
   * Per-caller-file precomputed facts, so consumers (blast) can attribute
   * endpoints/crons to the changed symbol whose callers live in that file.
   * Present on the persistent (non-degraded) path; absent otherwise.
   */
  factsByFile: z
    .record(z.string(), z.object({ endpoints: z.array(z.string()), crons: z.array(z.string()) }))
    .optional(),
  /**
   * Pre-cap caller count per changed symbol (keyed by `viaSymbol` / symbol
   * name), recorded **before** the per-symbol `MAX_CALLERS_PER_SYMBOL` slice.
   * Lets consumers (blast module's `PrBlastSymbol.callerCount`) report the
   * true total rather than the post-cap array length.
   *
   * Present on the persistent (non-degraded) path; absent otherwise (the
   * ripgrep/degraded path has no cap and no rank sort, so no consumer needs
   * the distinction).
   */
  callerCounts: z.record(z.string(), z.number().int()).optional(),
  degraded: z.boolean().optional(),
  reason: DegradedReason.optional(),
});
export type BlastResult = z.infer<typeof BlastResult>;
