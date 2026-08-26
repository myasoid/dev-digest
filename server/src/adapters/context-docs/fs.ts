import { promises as fs } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { EXCLUDED_DIRS, EXCLUDED_ROOTED_PATHS, MAX_CONTEXT_DOCS } from './constants.js';
import {
  CONTEXT_DOC_TYPES,
  ContextDocReadError,
  ContextDocTraversalError,
  typeForContextDocPath,
  type ContextDocListResult,
  type ContextDocMeta,
  type ContextDocsPort,
} from './types.js';

const DEVDIGEST_DIR = '.devdigest';

/**
 * Filesystem-backed `ContextDocsPort` — the only place `node:fs` appears for
 * this feature (`onion-architecture`: outer ring, `src/adapters/*`).
 *
 * Containment is enforced INSIDE this adapter, not by trusting the schema
 * layer alone: `resolveContained` is checked before `read()` ever calls
 * `readFile`, so a symlink anywhere in the working copy that resolves outside
 * it is rejected the same way a `..` segment is (EC-14).
 */
export class FsContextDocsAdapter implements ContextDocsPort {
  async list(clonePath: string): Promise<ContextDocListResult> {
    const state: WalkState = { docs: [], truncated: false };
    await this.walk(clonePath, clonePath, state);
    // NFR-8: discovery order must not depend on filesystem enumeration order.
    state.docs.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { docs: state.docs, truncated: state.truncated };
  }

  /**
   * Recursive walk of the working copy, rooted at `root` (never re-entered —
   * `dir` is the directory currently being read). Never follows a symlink
   * (EC-23 gate 1) — the read-time `realpath` check is the authoritative
   * containment gate, so the walk simply never offers a symlinked escape
   * route as a list result. Excluded directories are pruned BEFORE
   * recursing, never after (R-E, NFR-5), and the walk stops enqueuing more
   * work as soon as one more discoverable document than the cap has been
   * seen (R-E, NFR-13) — not after collecting everything and slicing.
   */
  private async walk(root: string, dir: string, state: WalkState): Promise<void> {
    if (state.truncated) return;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      // AC-5: an absent/unreadable directory contributes nothing, not an error.
      return;
    }
    for (const entry of entries) {
      if (state.truncated) return;
      if (entry.isSymbolicLink()) continue; // EC-23 gate 1
      const abs = join(dir, entry.name);
      const relPath = toPosixPath(relative(root, abs));

      if (entry.isDirectory()) {
        if (isExcludedDir(entry.name, relPath)) continue; // EC-20, pruned before recursing
        await this.walk(root, abs, state);
        continue;
      }

      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue; // AC-3
      const stat = await fs.stat(abs).catch(() => undefined);
      if (!stat) continue;

      state.docs.push({
        // R-A: preserve the historic stripped identity for a `.devdigest`-
        // layout file so every existing attachment keeps resolving; the true
        // repo-relative path otherwise.
        path: legacyIdentityPath(relPath),
        type: typeForContextDocPath(relPath), // AC-2
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
      });
      // Detect "one more than the cap" rather than stopping exactly at it, so
      // `truncated` is accurate (not a false positive when the tree has
      // exactly MAX_CONTEXT_DOCS documents) while still bounding the extra
      // work to a single file beyond the cap, not the rest of the tree.
      if (state.docs.length > MAX_CONTEXT_DOCS) {
        state.docs.pop();
        state.truncated = true;
        return;
      }
    }
  }

  async read(clonePath: string, relPath: string): Promise<string> {
    const abs = await this.resolveContained(clonePath, relPath);
    let buf: Buffer;
    try {
      buf = await fs.readFile(abs);
    } catch (err) {
      throw new ContextDocReadError(relPath, (err as NodeJS.ErrnoException).message ?? 'unreadable');
    }
    try {
      // `fatal: true` — plain `.toString('utf8')` silently replaces invalid
      // byte sequences with U+FFFD instead of failing, which is exactly the
      // "partial content" AC-11 forbids returning.
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      throw new ContextDocReadError(relPath, 'not valid UTF-8');
    }
  }

  /**
   * Resolve `relPath` to an absolute path inside `clonePath`, or throw —
   * always before any `readFile` call (AC-4's "without reading any file").
   * Re-rooted at the working copy itself (not `.devdigest`, EC-14): a path
   * may now legitimately start with anything, so the old "first segment ∈
   * {specs,docs,insights}" lexical gate is gone — containment is enforced
   * entirely by the `realpath` check below.
   *
   * R-A note: `relPath` may be either the true repo-relative path OR the
   * historic stripped identity of a `.devdigest`-layout file (e.g.
   * `specs/public-api.md` for `.devdigest/specs/public-api.md`). Both shapes
   * must keep resolving, so a path whose first segment names one of the
   * three legacy type directories is tried under `.devdigest/` FIRST (every
   * existing attachment is exactly this shape) and falls back to the literal
   * repo-relative location — which is also how a genuinely new top-level
   * `specs/`/`docs/`/`insights/` folder (no `.devdigest` involved) resolves.
   */
  private async resolveContained(clonePath: string, relPath: string): Promise<string> {
    const rootReal = await fs.realpath(clonePath).catch(() => undefined);
    if (!rootReal) throw new ContextDocReadError(relPath, 'not found');

    for (const abs of candidatePaths(clonePath, relPath)) {
      const targetReal = await fs.realpath(abs).catch(() => undefined);
      if (!targetReal) continue; // this candidate doesn't exist — try the next

      const rel = relative(rootReal, targetReal);
      if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
        throw new ContextDocTraversalError(relPath);
      }
      return abs;
    }
    throw new ContextDocReadError(relPath, 'not found');
  }
}

interface WalkState {
  docs: ContextDocMeta[];
  truncated: boolean;
}

function toPosixPath(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}

/** EC-20: a directory is excluded by NAME at any depth, or (one entry only,
 *  `server/clones`) by its path relative to the working-copy root. */
function isExcludedDir(name: string, relPath: string): boolean {
  if ((EXCLUDED_DIRS as readonly string[]).includes(name)) return true;
  return (EXCLUDED_ROOTED_PATHS as readonly string[]).includes(relPath);
}

/** R-A: strip a `.devdigest/<specs|docs|insights>/…` prefix back to the
 *  historic `${type}/${rest}` identity; every other path is left as its true
 *  repo-relative form. */
function legacyIdentityPath(trueRelPath: string): string {
  const segments = trueRelPath.split('/');
  const type = segments[1];
  if (segments[0] === DEVDIGEST_DIR && type && (CONTEXT_DOC_TYPES as readonly string[]).includes(type)) {
    return segments.slice(1).join('/');
  }
  return trueRelPath;
}

/** The inverse of `legacyIdentityPath`, tried in the order that preserves
 *  backward compatibility: the historic `.devdigest/<relPath>` location
 *  first (when `relPath` looks like a legacy identity), then the literal
 *  repo-relative location. */
function candidatePaths(clonePath: string, relPath: string): string[] {
  const first = relPath.split('/')[0];
  const out: string[] = [];
  if (first && (CONTEXT_DOC_TYPES as readonly string[]).includes(first)) {
    out.push(join(clonePath, DEVDIGEST_DIR, relPath));
  }
  out.push(join(clonePath, relPath));
  return out;
}
