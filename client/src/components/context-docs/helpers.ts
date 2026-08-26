import type { ContextDocLink, ContextDocType, SpecFile } from "@devdigest/shared";
import { TOKEN_WARNING_AMBER, TOKEN_WARNING_RED, type TokenTier } from "./constants";

/**
 * Pure ordering/filtering/estimate logic for a Context tab (agent or skill).
 * Mirrors `AgentEditor/_components/SkillsTab/helpers.ts` almost exactly —
 * kept out of the component so the ARRANGEMENT is unit-tested and the drag
 * wiring stays a thin, untested shell (jsdom cannot drive a drag; NFR-9).
 */

/** A row in the panel — a `SpecFile`, plus whether it's attached-but-absent
 *  from the repository's current document list (EC-13). */
export interface ContextDocRow extends SpecFile {
  missing: boolean;
}

/** The first path segment names the type when a doc has to be synthesized
 *  (a missing row has no server-provided `type`). */
function inferTypeFromPath(path: string): ContextDocType {
  const first = path.split("/")[0];
  return first === "docs" || first === "insights" ? first : "specs";
}

/**
 * Visual order: attached documents first, in their stored order, then
 * everything else by path. An attached path absent from `docs` (deleted from
 * the repository, EC-13) is synthesized as a `missing: true` row so it stays
 * visible and detachable rather than silently disappearing.
 */
export function arrangeDocs(docs: SpecFile[], links: ContextDocLink[]): ContextDocRow[] {
  const byPath = new Map(docs.map((d) => [d.path, d]));
  const ordered = [...links].sort((a, b) => a.order - b.order);

  const attachedRows: ContextDocRow[] = ordered.map((link) => {
    const doc = byPath.get(link.path);
    if (doc) return { ...doc, missing: false };
    return {
      path: link.path,
      type: inferTypeFromPath(link.path),
      content: null,
      size: null,
      updated_at: null,
      est_tokens: null,
      used_by_agents: null,
      missing: true,
    };
  });

  const attachedPaths = new Set(links.map((l) => l.path));
  const rest = docs
    .filter((d) => !attachedPaths.has(d.path))
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((d): ContextDocRow => ({ ...d, missing: false }));

  return [...attachedRows, ...rest];
}

/** Move the item at `from` to `to`, returning a new array. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  if (item === undefined) return list;
  next.splice(to, 0, item);
  return next;
}

/**
 * The payload for `POST /agents|skills/:id/context-docs` — attached paths in
 * visual order. The server rewrites `order` from the array index.
 */
export function attachedPathsInOrder(ordered: ContextDocRow[], attached: ReadonlySet<string>): string[] {
  return ordered.filter((d) => attached.has(d.path)).map((d) => d.path);
}

/** Case-insensitive filter over a document's repository-relative path (AC-19). */
export function filterDocs(docs: ContextDocRow[], search: string): ContextDocRow[] {
  const q = search.trim().toLowerCase();
  if (!q) return docs;
  return docs.filter((d) => d.path.toLowerCase().includes(q));
}

/**
 * Estimated token total for the attached set, excluding rows marked missing
 * (AC-22, AC-18) — summed from each document's own `est_tokens` (already
 * `ceil(size / 4)`, server-side), rather than re-deriving it from content the
 * list response never carries.
 */
export function estTokens(docs: ContextDocRow[], attached: ReadonlySet<string>): number {
  return docs
    .filter((d) => attached.has(d.path) && !d.missing)
    .reduce((sum, d) => sum + (d.est_tokens ?? 0), 0);
}

/** Amber >= 25,000, red >= 50,000, else ok (AC-24). */
export function tokenTier(tokens: number): TokenTier {
  if (tokens >= TOKEN_WARNING_RED) return "red";
  if (tokens >= TOKEN_WARNING_AMBER) return "amber";
  return "ok";
}
