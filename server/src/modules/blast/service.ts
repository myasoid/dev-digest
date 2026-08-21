/**
 * BlastService — application ring.
 *
 * Orchestrates GET /pulls/:id/blast: resolves the PR, fetches changed files,
 * calls container.repoIntel for blast data and the import graph, then computes
 * the three-state status, per-symbol caller capping, two-level endpoint/cron
 * discovery, and the final PrBlastMap.
 *
 * Transport layer only in routes.ts. No Drizzle here.
 */
import type { PrBlastMap, PrBlastSymbol, PrBlastTarget, BlastStatus } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { BlastRepository } from './repository.js';

/** Cap on changed symbols to include in the map (ordered by file rank DESC). */
export const MAX_SYMBOLS = 50;

/** Per-symbol caller cap — mirrors repo-intel's constant. */
export const MAX_CALLERS_PER_SYMBOL = 20;

export class BlastService {
  private readonly blastRepo: BlastRepository;

  constructor(private container: Container) {
    this.blastRepo = new BlastRepository(container.db);
  }

  async getBlastMap(workspaceId: string, prId: string): Promise<PrBlastMap> {
    // Resolve PR and repo through the shared ReviewRepository (no direct DB).
    const pr = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pr) throw new NotFoundError('Pull request not found');

    const repo = await this.container.reviewRepo.getRepo(pr.repoId);
    if (!repo) throw new NotFoundError('Repository not found');

    // Changed file paths for this PR.
    const prFileRows = await this.container.reviewRepo.getPrFiles(prId);
    const changedFiles = prFileRows.map((f) => f.path);

    // Fetch the raw blast result from repo-intel (handles degraded/flag-off).
    const blastResult = await this.container.repoIntel.getBlastRadius(repo.id, changedFiles);

    // Fetch the index state to compute tri-state status and staleness.
    const indexState = await this.container.repoIntel.getIndexState(repo.id);

    // --- Degraded path (flag off, no index, ripgrep best-effort) -----------
    if (blastResult.degraded) {
      const reason = blastResult.reason ?? 'no_data';
      const explanation = deriveExplanation('degraded', reason, false, null, false, false, false);
      return {
        status: 'degraded',
        explanation,
        reason,
        indexedSha: null,
        stale: false,
        symbols: [],
        symbolsTruncated: false,
        endpoints: [],
        crons: [],
        priorPrs: [],
        counts: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
      };
    }

    // --- Persistent-index path ----------------------------------------------
    const indexedSha = indexState.lastIndexedSha || null;
    const stale = Boolean(indexedSha && pr.headSha && indexedSha !== pr.headSha);
    const isPartialIndex = indexState.status === 'partial';

    // Build per-symbol structures from BlastResult.
    const { symbolsTruncated, perSymbolCallerCounts, cappedSymbols, symbolCapHit } =
      buildSymbols(blastResult.changedSymbols, blastResult.callers, blastResult.callerCounts);

    // Two-level endpoint/cron discovery via getReverseImporters.
    const { endpoints, crons, traversalTruncated } = await this.discoverTargets(
      repo.id,
      changedFiles,
      blastResult.factsByFile ?? {},
    );

    // Any cap hit → partial.
    const anyCapHit = symbolCapHit || traversalTruncated ||
      [...perSymbolCallerCounts.values()].some((c) => c.truncated);

    // Tri-state status.
    const status = deriveStatus(isPartialIndex, stale, anyCapHit);

    // Build explanation prose.
    const explanation = status === 'ok'
      ? null
      : deriveExplanation(
          status,
          null,
          isPartialIndex,
          stale ? (indexedSha ?? null) : null,
          symbolCapHit,
          traversalTruncated,
          [...perSymbolCallerCounts.values()].some((c) => c.truncated),
        );

    // Assemble PrBlastSymbol[]: attach callerCount + truncated from pre-cap data.
    const symbols: PrBlastSymbol[] = cappedSymbols.map((s) => {
      const counts = perSymbolCallerCounts.get(s.name) ?? { total: s.callers.length, truncated: false };
      return {
        file: s.file,
        name: s.name,
        kind: s.kind,
        callers: s.callers,
        callerCount: counts.total,
        truncated: counts.truncated,
      };
    });

    const totalCallers = symbols.reduce((acc, s) => acc + s.callers.length, 0);

    // Prior PRs sharing at least one changed file (Phase 3).
    // Degrades to [] on error — a repo with no prior PRs is not "partial",
    // and a DB hiccup here must not change the top-level status.
    const priorPrs = await this.blastRepo
      .getPriorPrs(repo.id, repo.fullName, prId, changedFiles)
      .catch(() => []);

    return {
      status,
      explanation,
      reason: null,
      indexedSha: indexedSha ?? null,
      stale,
      symbols,
      symbolsTruncated,
      endpoints,
      crons,
      priorPrs, // Phase 3: populated via BlastRepository.getPriorPrs
      counts: {
        symbols: symbols.length,
        callers: totalCallers,
        endpoints: endpoints.length,
        crons: crons.length,
      },
    };
  }

  /**
   * Two-level endpoint/cron discovery.
   *
   * 1. For each changed file, union the depth-1 caller files (from blastResult.factsByFile).
   * 2. Call getReverseImporters to get depth-2 importers of all direct caller files.
   * 3. Call getFactsForFiles over the union, emit PrBlastTarget[] with the minimum depth.
   */
  private async discoverTargets(
    repoId: string,
    changedFiles: string[],
    factsByFile: Record<string, { endpoints: string[]; crons: string[] }>,
  ): Promise<{ endpoints: PrBlastTarget[]; crons: PrBlastTarget[]; traversalTruncated: boolean }> {
    // Depth-1 caller files come from factsByFile (already computed by blast).
    const depth1Files = Object.keys(factsByFile);

    // Reverse-traverse from the changed files to find depth-2 importers.
    const reverseResult = await this.container.repoIntel.getReverseImporters(
      repoId,
      changedFiles,
      2,
    );
    const traversalTruncated = reverseResult.truncated;

    // Build a unified map: file → minimum depth at which it was reached.
    // Changed files themselves are depth 0 (excluded from target computation);
    // depth-1 files come from factsByFile keys; depth-2 from traversal.
    const fileDepthMap = new Map<string, number>();
    for (const f of depth1Files) {
      fileDepthMap.set(f, 1);
    }
    for (const [f, d] of reverseResult.files) {
      const existing = fileDepthMap.get(f);
      if (existing === undefined || d < existing) {
        fileDepthMap.set(f, d);
      }
    }

    if (fileDepthMap.size === 0) {
      return { endpoints: [], crons: [], traversalTruncated };
    }

    // Fetch facts for the full union of files (depth 1 + depth 2).
    const allFiles = [...fileDepthMap.keys()];
    const facts = await this.container.repoIntel.getFactsForFiles(repoId, allFiles);

    // Build PrBlastTarget[]: group each label → viaFiles and minimum depth.
    const endpointMap = new Map<string, { viaFiles: Set<string>; depth: 1 | 2 }>();
    const cronMap = new Map<string, { viaFiles: Set<string>; depth: 1 | 2 }>();

    for (const fact of facts) {
      const depth = (fileDepthMap.get(fact.filePath) ?? 1) as 1 | 2;
      for (const label of fact.endpoints) {
        const existing = endpointMap.get(label);
        if (existing) {
          existing.viaFiles.add(fact.filePath);
          if (depth < existing.depth) existing.depth = depth;
        } else {
          endpointMap.set(label, { viaFiles: new Set([fact.filePath]), depth });
        }
      }
      for (const label of fact.crons) {
        const existing = cronMap.get(label);
        if (existing) {
          existing.viaFiles.add(fact.filePath);
          if (depth < existing.depth) existing.depth = depth;
        } else {
          cronMap.set(label, { viaFiles: new Set([fact.filePath]), depth });
        }
      }
    }

    const endpoints: PrBlastTarget[] = [...endpointMap.entries()].map(([label, v]) => ({
      label,
      viaFiles: [...v.viaFiles],
      depth: v.depth,
    }));
    const crons: PrBlastTarget[] = [...cronMap.entries()].map(([label, v]) => ({
      label,
      viaFiles: [...v.viaFiles],
      depth: v.depth,
    }));

    return { endpoints, crons, traversalTruncated };
  }
}

// ---------------------------------------------------------------------------
// Pure helpers — unit-testable without a DB
// ---------------------------------------------------------------------------

type PerSymbolCount = { total: number; truncated: boolean };

interface BuildSymbolsResult {
  cappedSymbols: Array<{
    file: string;
    name: string;
    kind: string;
    callers: import('@devdigest/shared').BlastCallerRow[];
  }>;
  symbolsTruncated: boolean;
  symbolCapHit: boolean;
  perSymbolCallerCounts: Map<string, PerSymbolCount>;
}

/**
 * Cap symbols at MAX_SYMBOLS and compute per-symbol caller counts using the
 * true pre-cap totals from `BlastResult.callerCounts`.
 *
 * `callerCounts` is the `Record<viaSymbol, preCap total>` threaded from
 * `tryPersistentBlast` before the per-group slice. When present:
 *   - `total`    = the true pre-cap count from `callerCounts[s.name]`
 *   - `truncated` = `total > callers.length` (exact, not a `>=` guess)
 *
 * When absent (ripgrep/degraded path, which has no cap):
 *   - `total`    = the post-cap array length (same as callers.length)
 *   - `truncated` = false (no cap was applied, so nothing was dropped)
 *
 * `symbolsTruncated` is true when changedSymbols exceeded MAX_SYMBOLS.
 */
export function buildSymbols(
  changedSymbols: import('@devdigest/shared').BlastChangedSymbol[],
  callers: import('@devdigest/shared').BlastCallerRow[],
  callerCounts?: Record<string, number>,
): BuildSymbolsResult {
  const symbolCapHit = changedSymbols.length > MAX_SYMBOLS;
  const cappedSymbolDefs = symbolCapHit
    ? changedSymbols.slice(0, MAX_SYMBOLS)
    : changedSymbols;
  const symbolsTruncated = symbolCapHit;

  // Group the (already per-symbol-capped) callers by viaSymbol so we can
  // attach the right slice to each symbol's entry.
  const callersBySymbol = new Map<string, import('@devdigest/shared').BlastCallerRow[]>();
  for (const c of callers) {
    const arr = callersBySymbol.get(c.viaSymbol);
    if (arr) arr.push(c);
    else callersBySymbol.set(c.viaSymbol, [c]);
  }

  const perSymbolCallerCounts = new Map<string, PerSymbolCount>();
  const cappedSymbols = cappedSymbolDefs.map((s) => {
    const group = callersBySymbol.get(s.name) ?? [];
    let total: number;
    let truncated: boolean;
    if (callerCounts !== undefined) {
      // Use the true pre-cap total threaded from tryPersistentBlast.
      total = callerCounts[s.name] ?? group.length;
      truncated = total > group.length;
    } else {
      // Degraded/ripgrep path: no cap was applied; report what we received.
      total = group.length;
      truncated = false;
    }
    perSymbolCallerCounts.set(s.name, { total, truncated });
    return { file: s.file, name: s.name, kind: s.kind, callers: group };
  });

  return { cappedSymbols, symbolsTruncated, symbolCapHit, perSymbolCallerCounts };
}

/**
 * Derive the tri-state status. Rule table from the spec:
 * - `degraded`: BlastResult.degraded === true (handled before this is called)
 * - `partial`: index status === 'partial', OR stale, OR any cap hit
 * - `ok`: otherwise
 */
export function deriveStatus(
  isPartialIndex: boolean,
  stale: boolean,
  anyCapHit: boolean,
): BlastStatus {
  if (isPartialIndex || stale || anyCapHit) return 'partial';
  return 'ok';
}

/**
 * Derive the explanation prose for non-ok statuses.
 * When `indexedSha` is non-null, the result is stale and the SHA appears in
 * the explanation (short form, first 7 chars).
 */
export function deriveExplanation(
  status: BlastStatus,
  degradedReason: string | null,
  isPartialIndex: boolean,
  staleSha: string | null,
  symbolCapHit: boolean,
  traversalTruncated: boolean,
  callerCapHit: boolean,
): string {
  if (status === 'degraded') {
    if (degradedReason === 'flag_off') {
      return 'Blast radius is disabled: REPO_INTEL_ENABLED is off on the server. Enable it and restart the API to get real blast data.';
    }
    return `Blast radius is degraded (reason: ${degradedReason ?? 'no_data'}) — this repo isn't fully indexed, so callers/impact may be incomplete. Trigger indexing with a resync in DevDigest (POST /repos/:id/resync) and retry.`;
  }

  // Partial: collect all conditions that fired.
  const reasons: string[] = [];
  if (staleSha !== null) {
    const short = staleSha.slice(0, 7);
    reasons.push(`The index is behind this PR's head; callers are resolved against \`${short}\`.`);
  }
  if (isPartialIndex) {
    reasons.push('The index is partial (indexing did not complete for this repo).');
  }
  if (callerCapHit) {
    reasons.push(`Caller list is capped at ${MAX_CALLERS_PER_SYMBOL} per symbol; some callers are not shown.`);
  }
  if (symbolCapHit) {
    reasons.push(`Symbol list is capped at ${MAX_SYMBOLS}; some changed symbols are not shown.`);
  }
  if (traversalTruncated) {
    reasons.push('Reverse-import traversal hit the 200-file cap; some depth-2 endpoints may be missing.');
  }
  return reasons.join(' ') || 'Results may be incomplete.';
}
