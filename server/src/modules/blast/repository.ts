/**
 * Blast module — repository (infrastructure ring).
 *
 * The ONLY place in the blast module that imports drizzle-orm or db/schema.
 * Encapsulates the prior-PR query so service.ts and routes.ts stay clean of
 * raw Drizzle (enforced by `no-restricted-imports` in eslint.config.js).
 */
import { and, eq, ne, inArray, sql, desc } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/** One prior PR that shares at least one changed file with the target PR. */
export interface PriorPr {
  number: number;
  title: string;
  url: string;
  sharedFiles: string[];
}

/** Max prior PRs to return (ranked by shared-file count DESC). */
const MAX_PRIOR_PRS = 5;

/**
 * Prior pull requests in the same repo that touched at least one file in
 * `changedFiles`, excluding:
 *   - the target PR itself (`excludePrId`)
 *   - any PR with `files_count > 50` (high-churn refactors that touch
 *     everything and add no reviewer signal — see spec Open Questions,
 *     "Prior PRs relevance")
 *
 * Ranked by count of shared files DESC, limited to MAX_PRIOR_PRS.
 * URL is constructed as `https://github.com/{fullName}/pull/{number}`.
 */
export class BlastRepository {
  constructor(private db: Db) {}

  async getPriorPrs(
    repoId: string,
    repoFullName: string,
    excludePrId: string,
    changedFiles: string[],
  ): Promise<PriorPr[]> {
    if (changedFiles.length === 0) return [];

    // Join pr_files → pull_requests:
    //   - same repo
    //   - exclude the current PR
    //   - exclude high-churn PRs (files_count > 50 — blanket refactors /
    //     lockfile commits add no reviewer signal; see spec "Prior PRs relevance")
    //   - file path must be one of the changed files (inArray → ANY($1))
    // Group by PR, count shared files, order by count DESC, take 5.
    const rows = await this.db
      .select({
        number: t.pullRequests.number,
        title: t.pullRequests.title,
        sharedCount: sql<number>`cast(count(*) as integer)`,
        sharedFiles: sql<string[]>`array_agg(${t.prFiles.path} order by ${t.prFiles.path})`,
      })
      .from(t.prFiles)
      .innerJoin(t.pullRequests, eq(t.prFiles.prId, t.pullRequests.id))
      .where(
        and(
          eq(t.pullRequests.repoId, repoId),
          ne(t.pullRequests.id, excludePrId),
          // files_count <= 50: exclude high-churn / blanket-refactor PRs.
          sql`${t.pullRequests.filesCount} <= 50`,
          inArray(t.prFiles.path, changedFiles),
        ),
      )
      .groupBy(t.pullRequests.id, t.pullRequests.number, t.pullRequests.title)
      .orderBy(desc(sql`count(*)`))
      .limit(MAX_PRIOR_PRS);

    return rows.map((r) => ({
      number: r.number,
      title: r.title,
      url: `https://github.com/${repoFullName}/pull/${r.number}`,
      sharedFiles: r.sharedFiles ?? [],
    }));
  }
}
