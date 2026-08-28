import { z } from 'zod';
import { BlastCallerRow, DegradedReason } from './blast.js';

/**
 * PR-scoped blast radius view — the impact map for a specific pull request.
 *
 * Built on top of `BlastResult` (repo-intel's raw facade output in
 * `contracts/blast.ts`) but carries a three-state `status`, tri-level endpoint
 * discovery (depth 1 and 2), and PR-scoped metadata (prior PRs).
 *
 * Naming: `BlastRadius` was taken in `contracts/brief.ts` (a `PrBrief`
 * summary field with a different shape) at the time this was named — removed
 * 2026-08-27 when `PrBrief` was repurposed (SPEC-cross-06). `BlastResult` is
 * repo-intel's raw facade return in `contracts/blast.ts`. This is the
 * PR-scoped view — `PrBlastMap`.
 *
 * Served by `GET /pulls/:id/blast` (server/src/modules/blast/routes.ts).
 */

export const BlastStatus = z.enum(['ok', 'partial', 'degraded']);
export type BlastStatus = z.infer<typeof BlastStatus>;

export const PrBlastSymbol = z.object({
  file: z.string(),
  name: z.string(),
  kind: z.string(),
  callers: z.array(BlastCallerRow),
  /** Total callers before the per-symbol cap was applied. */
  callerCount: z.number().int(),
  /** True when `callers` is capped at MAX_CALLERS_PER_SYMBOL. */
  truncated: z.boolean(),
});
export type PrBlastSymbol = z.infer<typeof PrBlastSymbol>;

export const PrBlastTarget = z.object({
  /** "METHOD /path" (endpoint) or cron expression / job name. */
  label: z.string(),
  /** Files through which this target was reached. */
  viaFiles: z.array(z.string()),
  /** Traversal depth at which this target was first found (1 = direct caller, 2 = indirect). */
  depth: z.union([z.literal(1), z.literal(2)]),
});
export type PrBlastTarget = z.infer<typeof PrBlastTarget>;

export const PrBlastMap = z.object({
  status: BlastStatus,
  /**
   * Non-null whenever status !== 'ok'. Plain prose shown verbatim in the UI.
   * Describes which condition fired (staleness, partial index, cap, degraded).
   */
  explanation: z.string().nullable(),
  /** Why the index is degraded — reused from contracts/blast.ts. Null when not degraded. */
  reason: DegradedReason.nullable(),
  /** SHA the index was built at — what file:line links are pinned to. */
  indexedSha: z.string().nullable(),
  /** True when indexedSha !== the PR's head_sha. */
  stale: z.boolean(),
  /** Changed symbols, each with their capped caller list. */
  symbols: z.array(PrBlastSymbol),
  /** True when symbols was capped at 50. */
  symbolsTruncated: z.boolean(),
  /** HTTP endpoints reachable from changed symbols (depth 1 and 2). */
  endpoints: z.array(PrBlastTarget),
  /** Scheduled jobs reachable from changed symbols (depth 1 and 2). */
  crons: z.array(PrBlastTarget),
  /**
   * Prior PRs that touched at least one of the same files as this PR.
   * Phase 1: always []. Phase 3: populated.
   */
  priorPrs: z.array(
    z.object({
      number: z.number().int(),
      title: z.string(),
      url: z.string(),
      sharedFiles: z.array(z.string()),
    }),
  ),
  /**
   * Counts reflecting what is actually returned (post-cap), not pre-cap totals.
   * Truncation is stated separately via `symbolsTruncated` / `PrBlastSymbol.truncated`.
   */
  counts: z.object({
    symbols: z.number().int(),
    callers: z.number().int(),
    endpoints: z.number().int(),
    crons: z.number().int(),
  }),
});
export type PrBlastMap = z.infer<typeof PrBlastMap>;
