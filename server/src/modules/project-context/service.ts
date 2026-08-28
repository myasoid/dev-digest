import type { Container } from '../../platform/container.js';
import type { ContextDocLink, IndexStatus, SpecFile, SpecFileList } from '@devdigest/shared';
import { typeForContextDocPath } from '../../adapters/context-docs/types.js';
import { ContextDocReadError, ContextDocTraversalError } from '../../adapters/context-docs/types.js';
import { NotSyncedError, ValidationError } from '../../platform/errors.js';
import { ContextDocsRepository, type OwnerKind } from './repository.js';
import { REPO_NOT_SYNCED_MESSAGE } from './constants.js';

/**
 * Project Context service — orchestrates the read-only document port
 * (`container.contextDocs`) and the attachment repository. Owns the
 * "effective set" read-side aggregates (`used_by_agents`) and the distinct
 * "not synced" rule; the RUN-TIME resolution (agent + skills → ordered texts)
 * is a separate pure function in `modules/reviews/context-docs.ts` (Step 8),
 * not here.
 */
export class ProjectContextService {
  private repo: ContextDocsRepository;

  constructor(private container: Container) {
    this.repo = new ContextDocsRepository(container.db);
  }

  /**
   * GET /repos/:id/context — metadata only, `content` null (AC-8). The
   * envelope's `truncated`/`shown` (NFR-13) come straight from the adapter's
   * walk-time cap, set here in the service, never computed in the route.
   */
  async list(workspaceId: string, repoId: string): Promise<SpecFileList> {
    const clonePath = await this.requireClonePath(workspaceId, repoId);
    const [{ docs: metas, truncated }, usedBy] = await Promise.all([
      this.container.contextDocs.list(clonePath),
      this.repo.usedByAgentsPerPath(workspaceId),
    ]);
    const files: SpecFile[] = metas.map((m) => ({
      path: m.path,
      type: m.type,
      content: null,
      size: m.size,
      updated_at: m.updatedAt,
      // Estimated from bytes, not read content — the list stays a metadata-only
      // read (no N-file read just to size a token count); markdown is
      // near-ASCII so bytes and chars track closely enough for an estimate.
      est_tokens: Math.ceil(m.size / 4),
      used_by_agents: usedBy.get(m.path) ?? 0,
    }));
    return { files, truncated, shown: files.length };
  }

  /** GET /repos/:id/context/doc?path= — `content` non-null (AC-9). */
  async doc(workspaceId: string, repoId: string, path: string): Promise<SpecFile> {
    const clonePath = await this.requireClonePath(workspaceId, repoId);
    let content: string;
    try {
      content = await this.container.contextDocs.read(clonePath, path);
    } catch (err) {
      if (err instanceof ContextDocTraversalError) {
        throw new ValidationError(`Invalid document path: ${path}`);
      }
      if (err instanceof ContextDocReadError) {
        throw new ValidationError(`Could not read document: ${path}`, { path });
      }
      throw err;
    }
    const usedBy = await this.repo.usedByAgentsPerPath(workspaceId);
    return {
      path,
      type: typeForContextDocPath(path),
      content,
      size: Buffer.byteLength(content, 'utf8'),
      updated_at: null,
      est_tokens: Math.ceil(content.length / 4),
      used_by_agents: usedBy.get(path) ?? 0,
    };
  }

  /** POST /repos/:id/context/reindex — re-walks the working copy. */
  async reindex(workspaceId: string, repoId: string): Promise<IndexStatus> {
    const clonePath = await this.requireClonePath(workspaceId, repoId);
    const { docs, truncated } = await this.container.contextDocs.list(clonePath);
    return {
      status: 'done',
      pct: 100,
      message: truncated
        ? `${docs.length} document(s) found (truncated at the discovery cap)`
        : `${docs.length} document(s) found`,
      chunks_indexed: null,
    };
  }

  /** GET /agents|skills/:id/context-docs — undefined ⇒ the route 404s. */
  async linksFor(
    workspaceId: string,
    ownerKind: OwnerKind,
    ownerId: string,
  ): Promise<ContextDocLink[] | undefined> {
    if (!(await this.repo.ownerExists(workspaceId, ownerKind, ownerId))) return undefined;
    const rows = await this.repo.linksFor(ownerKind, ownerId);
    return rows.map((r) => this.toLinkDto(r));
  }

  /**
   * POST /agents|skills/:id/context-docs — set-and-reorder in one call.
   * Deliberately never touches `agents.version` / `agent_versions` (AC-21):
   * this method only writes `context_doc_links`.
   */
  async setLinks(
    workspaceId: string,
    ownerKind: OwnerKind,
    ownerId: string,
    paths: string[],
  ): Promise<ContextDocLink[] | undefined> {
    if (!(await this.repo.ownerExists(workspaceId, ownerKind, ownerId))) return undefined;
    // Dedupe keeping the first occurrence — a duplicate path in the payload
    // would otherwise violate the (owner_kind, owner_id, path) primary key.
    const seen = new Set<string>();
    const deduped = paths.filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
    await this.repo.setLinks(ownerKind, ownerId, deduped);
    return this.linksFor(workspaceId, ownerKind, ownerId);
  }

  private toLinkDto(row: { ownerKind: string; ownerId: string; path: string; order: number }): ContextDocLink {
    return {
      owner_kind: row.ownerKind as OwnerKind,
      owner_id: row.ownerId,
      path: row.path,
      order: row.order,
    };
  }

  private async requireClonePath(workspaceId: string, repoId: string): Promise<string> {
    const clonePath = await this.repo.getClonePath(workspaceId, repoId);
    if (!clonePath) throw new NotSyncedError(REPO_NOT_SYNCED_MESSAGE);
    return clonePath;
  }
}
