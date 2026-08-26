import { and, asc, count, eq, sql } from 'drizzle-orm';
import type { Db, Executor } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Project Context data-access. The ONLY file issuing Drizzle queries against
 * `context_doc_links` (`onion-architecture` §Instructions 1) — `run-executor.ts`
 * and the agents/skills modules reach it through `container.contextDocsRepo`,
 * never by importing this file's folder directly.
 *
 * Also owns the repo-scoped `clonePath` lookup (mirrors
 * `conventions/repository.ts:30-36`) and the cross-table `owner` existence
 * check the attachment routes need — both read other modules' tables the same
 * way `AgentsRepository.existingSkillIds` already reads `skills`.
 */

export type OwnerKind = 'agent' | 'skill';
export type ContextDocLinkRow = typeof t.contextDocLinks.$inferSelect;

export class ContextDocsRepository {
  constructor(private db: Db) {}

  /** Clone path for a repo, scoped to this workspace. `null` covers both
   *  "no such repo here" and "repo not cloned yet" — callers treat them the
   *  same (AC-6: the distinct not-synced error). */
  async getClonePath(workspaceId: string, repoId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ clonePath: t.repos.clonePath })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row?.clonePath ?? null;
  }

  /** Whether an agent/skill id belongs to this workspace — the attachment
   *  routes' scoping guard (deny by default across workspaces). */
  async ownerExists(workspaceId: string, ownerKind: OwnerKind, ownerId: string): Promise<boolean> {
    if (ownerKind === 'agent') {
      const [row] = await this.db
        .select({ id: t.agents.id })
        .from(t.agents)
        .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, ownerId)));
      return !!row;
    }
    const [row] = await this.db
      .select({ id: t.skills.id })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, ownerId)));
    return !!row;
  }

  /** Links for one owner, `order` ascending, `path` as the tiebreak (EC-17,
   *  NFR-8: two identical configurations resolve byte-identically). */
  async linksFor(ownerKind: OwnerKind, ownerId: string): Promise<ContextDocLinkRow[]> {
    return this.db
      .select()
      .from(t.contextDocLinks)
      .where(and(eq(t.contextDocLinks.ownerKind, ownerKind), eq(t.contextDocLinks.ownerId, ownerId)))
      .orderBy(asc(t.contextDocLinks.order), asc(t.contextDocLinks.path));
  }

  /** Replace the whole set for an owner; `order` = array index — the same
   *  set-and-reorder shape as `AgentsRepository.setSkills`. */
  async setLinks(ownerKind: OwnerKind, ownerId: string, paths: string[]): Promise<void> {
    await this.db
      .delete(t.contextDocLinks)
      .where(and(eq(t.contextDocLinks.ownerKind, ownerKind), eq(t.contextDocLinks.ownerId, ownerId)));
    if (paths.length === 0) return;
    await this.db
      .insert(t.contextDocLinks)
      .values(paths.map((path, order) => ({ ownerKind, ownerId, path, order })));
  }

  /**
   * Delete every link owned by one agent/skill — the substitute for the FK
   * cascade a polymorphic `owner_id` cannot have. Accepts an `Executor` so the
   * OWNING service (`AgentsService.delete` / `SkillsService.delete`) can run
   * this in the SAME transaction as the owner row's delete.
   */
  async deleteLinksForOwner(executor: Executor, ownerKind: OwnerKind, ownerId: string): Promise<void> {
    await executor
      .delete(t.contextDocLinks)
      .where(and(eq(t.contextDocLinks.ownerKind, ownerKind), eq(t.contextDocLinks.ownerId, ownerId)));
  }

  /**
   * `context_doc_count` for every agent (or skill) in a workspace, in ONE
   * grouped query with an optional `ownerId` filter — the pattern
   * `server/INSIGHTS.md` (2026-08-14) records for `SkillsRepository.usedByCounts`
   * (R-5): a `conditions: SQLWrapper[]` array, not `and(..., maybe-undefined)`.
   */
  async linkCounts(
    workspaceId: string,
    ownerKind: OwnerKind,
    ownerId?: string,
  ): Promise<Map<string, number>> {
    const ownerTable = ownerKind === 'agent' ? t.agents : t.skills;
    const conditions = [
      eq(t.contextDocLinks.ownerKind, ownerKind),
      eq(ownerTable.workspaceId, workspaceId),
    ];
    if (ownerId) conditions.push(eq(t.contextDocLinks.ownerId, ownerId));
    const rows = await this.db
      .select({ ownerId: t.contextDocLinks.ownerId, count: count() })
      .from(t.contextDocLinks)
      .innerJoin(ownerTable, eq(ownerTable.id, t.contextDocLinks.ownerId))
      .where(and(...conditions))
      .groupBy(t.contextDocLinks.ownerId);
    return new Map(rows.map((r) => [r.ownerId, Number(r.count)]));
  }

  /**
   * `used_by_agents` per document path across a workspace — the EFFECTIVE
   * set: an agent that directly attaches the path, OR that links a globally
   * ENABLED skill which attaches it (US-8; counting direct attachments only
   * would report "0 agents" for a document three agents inject through a
   * shared skill). One raw grouped query (R-5) rather than two round trips
   * the caller would otherwise have to merge.
   */
  async usedByAgentsPerPath(workspaceId: string): Promise<Map<string, number>> {
    const rows = (await this.db.execute(sql`
      SELECT path, COUNT(DISTINCT agent_id)::int AS agents FROM (
        SELECT cdl.path AS path, cdl.owner_id AS agent_id
        FROM context_doc_links cdl
        JOIN agents a ON a.id = cdl.owner_id AND a.workspace_id = ${workspaceId}
        WHERE cdl.owner_kind = 'agent'
        UNION ALL
        SELECT cdl.path AS path, ags.agent_id AS agent_id
        FROM context_doc_links cdl
        JOIN skills sk ON sk.id = cdl.owner_id AND sk.enabled = true AND sk.workspace_id = ${workspaceId}
        JOIN agent_skills ags ON ags.skill_id = sk.id
        JOIN agents a2 ON a2.id = ags.agent_id AND a2.workspace_id = ${workspaceId}
        WHERE cdl.owner_kind = 'skill'
      ) effective
      GROUP BY path
    `)) as unknown as { path: string; agents: number }[];
    return new Map(rows.map((r) => [r.path, Number(r.agents)]));
  }
}
