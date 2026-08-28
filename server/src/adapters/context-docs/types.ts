import type { ContextDocType } from '@devdigest/shared';

/**
 * Read-only Project Context document port — lists and reads the `.md` files
 * beneath a repository working copy, anywhere except a standard exclusion
 * list (`./constants.ts`'s `EXCLUDED_DIRS`). Modelled on
 * `adapters/tickets/types.ts`: a small interface behind the DI container,
 * with a real fs-backed adapter and a deterministic fake for tests
 * (`adapters/mocks.ts`).
 *
 * Server-local by design (not a `@devdigest/shared` adapter interface) — the
 * client has no use for it, and putting it in the vendored tree would drag it
 * through `scripts/check-contracts.sh` for nothing. See `DepGraph`,
 * `Tokenizer` for the same precedent.
 */
export interface ContextDocsPort {
  /**
   * Every `.md` file beneath the working-copy root, walked recursively, the
   * exclusion list applied (EC-20) and capped at `MAX_CONTEXT_DOCS` (NFR-13,
   * `truncated: true` when the cap was hit). Returns `{ docs: [], truncated:
   * false }` when the working copy is absent or unreadable — AC-5 is "empty
   * list, not an error", not "throw and let the caller degrade".
   */
  list(clonePath: string): Promise<ContextDocListResult>;
  /**
   * Full UTF-8 text of one document by its repository-relative path (e.g.
   * `specs/public-api.md`, or a true repo-relative path for a document
   * outside `.devdigest`). Throws `ContextDocTraversalError` when `path`
   * resolves outside the working copy (checked BEFORE any file is opened —
   * AC-4) and `ContextDocReadError` when the file is missing or not valid
   * UTF-8 (AC-11) — never partial content.
   */
  read(clonePath: string, path: string): Promise<string>;
}

export interface ContextDocMeta {
  /**
   * Repository-relative identity path. For a document under
   * `.devdigest/{specs,docs,insights}/`, this is the historic stripped form
   * (`specs/public-api.md`) so every existing attachment keeps resolving
   * (R-A, EC-21) — for any other discoverable document, it is the true
   * repository-relative path (e.g. `docs/guide.md`, `README.md`). The shape
   * is therefore non-uniform by design, not an inconsistency.
   */
  path: string;
  type: ContextDocType;
  size: number;
  updatedAt: string;
}

export interface ContextDocListResult {
  docs: ContextDocMeta[];
  /** NFR-13: the walk stopped at `MAX_CONTEXT_DOCS` before exhausting the tree. */
  truncated: boolean;
}

export const CONTEXT_DOC_TYPES: readonly ContextDocType[] = ['specs', 'docs', 'insights'];

/**
 * A document's type (AC-2): a base name of `insights.md` (case-insensitive)
 * is always `insights`; otherwise the file's own directory segments are
 * scanned nearest-to-file toward the repository root for the first segment
 * named `specs`, `docs` or `insights` (case-insensitive), which becomes the
 * type; otherwise the type is `docs`. The `insights` segment case is what
 * keeps a document such as `.devdigest/insights/rate-limiting.md` (not
 * literally named `insights.md`) classifying as `insights` exactly as the
 * pre-amendment three-fixed-folder walk did (AC-2a, EC-21, and the seed
 * fixture this must not require rewriting).
 *
 * Always returns a `ContextDocType` — never `undefined`. Under the
 * pre-amendment code this function's `undefined` case doubled as the
 * traversal-rejection signal; a whole-repo walk means a path may now
 * legitimately start with anything, so that signal has moved entirely to the
 * `realpath`-before-read containment gate in `FsContextDocsAdapter`.
 */
export function typeForContextDocPath(relPath: string): ContextDocType {
  const segments = relPath.split('/');
  const base = segments[segments.length - 1] ?? '';
  if (base.toLowerCase() === 'insights.md') return 'insights';

  for (let i = segments.length - 2; i >= 0; i--) {
    const lower = (segments[i] ?? '').toLowerCase();
    if ((CONTEXT_DOC_TYPES as readonly string[]).includes(lower)) {
      return lower as ContextDocType;
    }
  }
  return 'docs';
}

/**
 * `path` resolves outside the repository's working copy — an absolute path,
 * a `..` escape, or a symlink whose `realpath` lands outside the working
 * copy. Always thrown before any file is opened (AC-4, EC-14).
 */
export class ContextDocTraversalError extends Error {
  constructor(public readonly path: string) {
    super(`path resolves outside the working-copy root: ${path}`);
    this.name = 'ContextDocTraversalError';
  }
}

/**
 * The document is missing, unreadable, or not valid UTF-8 (AC-11). Carries
 * the path — never the (possibly partial, possibly binary) content — so a
 * caller can name what failed without risking a leak.
 */
export class ContextDocReadError extends Error {
  constructor(
    public readonly path: string,
    reason: string,
  ) {
    super(`could not read document "${path}": ${reason}`);
    this.name = 'ContextDocReadError';
  }
}
