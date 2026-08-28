/**
 * Named constants for the whole-working-copy document walk (`./fs.ts`). Kept
 * as this feature's OWN constants rather than importing
 * `modules/repo-intel/constants.ts`'s `EXCLUDED_DIRS` / `MAX_INDEXED_FILES`
 * (R-B): the indexer's list is tuned for symbol indexing and doesn't include
 * `server/clones` or the nested-submodule-`.git` semantics this feature
 * needs (EC-20), and coupling the two features' walk scope would let an
 * unrelated repo-intel change silently alter document discovery.
 */

/**
 * EC-20 — directories never walked, matched by directory NAME at any depth
 * (so a nested submodule `.git` is pruned too, wherever it sits). Mirrors
 * `repo-intel`'s `EXCLUDED_DIRS`, extended for this feature's clone reality.
 * A single exported constant so a future addition is a one-line change.
 */
export const EXCLUDED_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  'vendor',
] as const;

/**
 * EC-20 — the one exclusion entry matched relative to the working-copy root
 * rather than by directory name: this repository's own cloned-repos root
 * (`server/clones`), which root `CLAUDE.md` forbids reading, and which only
 * matters when the repository BEING WALKED is itself a clone of this
 * codebase (dogfooding).
 */
export const EXCLUDED_ROOTED_PATHS = ['server/clones'] as const;

/**
 * NFR-13 — the walk stops after this many discoverable `.md` files and
 * reports itself `truncated`, rather than surfacing an unbounded list (or an
 * unbounded `used_by_agents` fan-out, `service.ts`). Set below
 * `repo-intel`'s `MAX_INDEXED_FILES = 5000` (R-C): that number is tuned for
 * an index, not a list rendered in a browser with a per-document fan-out
 * query, and 5000 rows is already unusable as a flat list. A one-line change
 * if this value proves wrong.
 */
export const MAX_CONTEXT_DOCS = 1000;
