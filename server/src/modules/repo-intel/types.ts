/**
 * repo-intel — shared contract (Tier 1).
 *
 * This is the SINGLE interface every feature codes against. Library complexity
 * (@ast-grep/napi, dependency-cruiser, graphology, tokenizer) hides behind the
 * `RepoIntel` facade; features (reviews prompt-assembly, blast, onboarding,
 * conventions, phantom-gate, smart-diff) import THIS, never the libraries.
 *
 * Adapted to real code:
 *   - `repos.id` is a `uuid`, so every `repoId` here is a `string`.
 *   - facade-level rows (SymbolRow / SignatureRow / RefRow) mirror the read model.
 *   - adapter-level extraction types live with the astgrep adapter and stay
 *     compatible with `adapters/codeindex/extract.ts` (ExtractedSymbol/Reference).
 *
 * DEGRADED CONTRACT (lead decision — resolves the read-model vs degraded-contract ambiguity):
 *   - Object-returning methods carry an inline `degraded?: boolean` (+ optional
 *     `reason`). See BlastResult / IndexState / RepoMapResult.
 *   - Array-returning methods return `[]` when degraded. Empty = "no enrichment",
 *     which is exactly what every consumer already treats as the fallback path.
 *     The degraded *status/reason* is always observable via `getIndexState()`.
 * This keeps signatures natural (no `{ degraded, data }` wrappers at call sites)
 * while still guaranteeing every consumer can fall back without throwing.
 */
import type { BlastCallerRow, BlastChangedSymbol, BlastResult, DegradedReason } from '@devdigest/shared';

export type IndexStatus = 'full' | 'partial' | 'degraded' | 'failed';

/**
 * `DegradedReason`, `BlastChangedSymbol`, `BlastCallerRow`, `BlastResult` are
 * authoritatively defined as Zod schemas in `@devdigest/shared`
 * (`contracts/blast.ts`) so `POST /repos/:id/blast` can declare a real
 * `response` schema. Re-exported here (inferred TS types only, imported
 * above so they stay usable within this file too) so every existing import
 * of these names from this module keeps working unchanged, and
 * `RepoIntelService.getBlastRadius()` needs no signature change. (An
 * unrelated `BlastRadius` type briefly existed in `contracts/brief.ts` as a
 * `PrBrief` summary field — removed 2026-08-27 when `PrBrief` was
 * repurposed, SPEC-cross-06.)
 */
export type { DegradedReason, BlastChangedSymbol, BlastCallerRow, BlastResult };

export interface IndexResult {
  status: IndexStatus;
  filesIndexed: number;
  filesSkipped: number;
  durationMs: number;
  reason?: string;
}

export interface IndexState extends IndexResult {
  repoId: string;
  lastIndexedSha: string;
  indexerVersion: number;
  updatedAt: Date;
  /** True when the layer is running on the ripgrep fallback. */
  degraded?: boolean;
  degradedReason?: DegradedReason;
}

// ---------------------------------------------------------------------------
// Blast radius (facade method `getBlastRadius`) — see the re-export block
// above (`DegradedReason` / `BlastChangedSymbol` / `BlastCallerRow` /
// `BlastResult`) for where these types now live.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Read-model rows.
// ---------------------------------------------------------------------------

export interface SymbolRow {
  file: string;
  name: string;
  kind: string;
  exported: boolean;
  startLine: number;
  endLine: number;
  signature: string | null;
}

export interface SignatureRow {
  file: string;
  symbol: string;
  signature: string;
  /** file_rank.rank of the caller (0 until T3). */
  rank: number;
}

export interface RefRow {
  refFile: string;
  refLine: number;
  symbolName: string;
  /** NULL = unresolved → candidate for the Phantom-gate. */
  declFile: string | null;
}

export interface FileRankRow {
  path: string;
  percentile: number;
}

/**
 * Return type for `getReverseImporters`: the set of files that (transitively)
 * import one of the seed files, with the minimum BFS depth at which each was
 * reached. `truncated` is true when the 200-visited-file cap was hit.
 */
export interface ReverseImportersResult {
  files: Map<string, number>;
  truncated: boolean;
}

/**
 * Per-file precomputed facts (endpoints and crons) returned by
 * `getFactsForFiles`. Mirrors `IndexerFileFactsRow` from the repository but
 * lives in types.ts so the facade interface can reference it without importing
 * from the repository layer.
 */
export interface FileFactsRow {
  filePath: string;
  endpoints: string[];
  crons: string[];
}

export interface RepoMapResult {
  text: string;
  tokens: number;
  cached: boolean;
  degraded?: boolean;
  reason?: DegradedReason;
}

/**
 * The facade. Studio (T2+) serves reads purely from the Postgres cache; T1 and
 * CI may parse diff-scoped on the hot path. Indexing runs through
 * JobRunner handlers in studio, inline in the CI runner.
 */
export interface RepoIntel {
  // --- Indexing -----------------------------------------------------------
  /** Full (re)index of a repo. */
  indexRepo(repoId: string): Promise<IndexResult>;
  /** Incremental update against the last indexed SHA. */
  refreshIndex(repoId: string): Promise<IndexResult>;
  /** Current index state — ALWAYS works, even degraded. */
  getIndexState(repoId: string): Promise<IndexState>;

  // --- Reads --------------------------------------------------------------
  getBlastRadius(repoId: string, changedFiles: string[]): Promise<BlastResult>;
  getRepoMap(repoId: string, tokenBudget?: number): Promise<RepoMapResult>;
  getFileRank(repoId: string, paths: string[]): Promise<FileRankRow[]>;
  getSymbolsInFiles(repoId: string, paths: string[]): Promise<SymbolRow[]>;
  getCallerSignatures(
    repoId: string,
    changedFiles: string[],
    limit?: number,
  ): Promise<SignatureRow[]>;
  /**
   * Unresolved references (= Phantom-gate fuel).
   * T1: diff-scoped, ephemeral (no persistent decl_file).
   * T2/T3: persistent `references.decl_file IS NULL`.
   */
  getUnresolvedReferences(repoId: string, files: string[]): Promise<RefRow[]>;
  /** Top-N file paths by rank, filtered of tests/configs. */
  getConventionSamples(repoId: string, n: number): Promise<string[]>;

  // --- T3: onboarding reading-path + critical paths (graph required) ------
  getTopFilesByRank(
    repoId: string,
    n: number,
    opts?: { exclude?: string[] },
  ): Promise<string[]>;
  getCriticalPaths(repoId: string): Promise<string[][]>;

  // --- Blast additions (Phase 1) ------------------------------------------
  /**
   * Reverse BFS over the import graph: which files import (transitively) any
   * of the given seed files, up to `depth` hops? Returns a Map<file, minDepth>
   * and a `truncated` flag when the 200-file visited cap was hit.
   *
   * Degrades to `{ files: new Map(), truncated: false }` when the flag is off
   * or no edges exist, matching the array-method degraded convention.
   */
  getReverseImporters(
    repoId: string,
    files: string[],
    depth: number,
  ): Promise<ReverseImportersResult>;

  /**
   * Public wrapper over the private `repo.getFileFacts`: endpoints and crons
   * for the given files. Returns `[]` when the flag is off or no facts exist.
   */
  getFactsForFiles(repoId: string, files: string[]): Promise<FileFactsRow[]>;
}
