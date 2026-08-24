import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ApiClient } from '../http/client.js';
import { ApiError } from '../http/client.js';
import { resolveRepoId, resolvePrId } from '../resolve.js';
import { toReviewResult, type ReviewApiRecord } from './map-review.js';
import { runTool, toolOk } from './result.js';

export interface GetFindingsArgs {
  repo: string;
  pr: number;
}

/** Wraps `GET /pulls/:id/reviews` (`server/src/modules/reviews/routes.ts:132-135`),
 * the latest `ReviewRecord` of kind "review" (the per-agent-run kind
 * `run-executor.ts` persists — "summary" rows are a different feature and are
 * not returned by run_agent_on_pr, so get_findings ignores them too). */
export async function getFindings(client: ApiClient, args: GetFindingsArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const repoId = await resolveRepoId(client, args.repo);
    const prId = await resolvePrId(client, repoId, args.repo, args.pr);
    const reviews = await client.get<ReviewApiRecord[]>(`/pulls/${prId}/reviews`);

    const completed = reviews
      .filter((r) => r.kind === 'review')
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
    const latest = completed[0];

    if (!latest) {
      throw new ApiError(
        `No completed reviews for PR #${args.pr} in ${args.repo} yet. Run one with run_agent_on_pr(repo, pr, agent).`,
        { code: 'no_reviews' },
      );
    }

    return toolOk(toReviewResult(latest));
  });
}
