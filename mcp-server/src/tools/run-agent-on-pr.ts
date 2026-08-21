import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ApiClient } from '../http/client.js';
import { ApiError } from '../http/client.js';
import { resolveRepoId, resolvePrId, resolveAgent } from '../resolve.js';
import { pollRunUntilTerminal, type PollOptions } from '../run-poller.js';
import { toReviewResult, type ReviewApiRecord } from './map-review.js';
import { runTool, toolOk, toolMessage } from './result.js';

export interface RunAgentOnPrArgs {
  repo: string;
  pr: number;
  agent: string;
}

/** The subset of `ReviewRunResponse` (`@devdigest/shared`) this tool needs. */
interface ReviewRunResponse {
  runs: Array<{ run_id: string; agent_id: string; agent_name: string }>;
}

/** Poll options are injectable only for tests — production always uses the
 * poller's ~2s/~180s defaults. */
export async function runAgentOnPr(
  client: ApiClient,
  args: RunAgentOnPrArgs,
  pollOptions?: PollOptions,
): Promise<CallToolResult> {
  return runTool(async () => {
    const repoId = await resolveRepoId(client, args.repo);
    const prId = await resolvePrId(client, repoId, args.repo, args.pr);
    const agent = await resolveAgent(client, args.agent);

    const started = await client.post<ReviewRunResponse>(`/pulls/${prId}/review`, { agentId: agent.id });
    const target = started.runs.find((r) => r.agent_id === agent.id);
    if (!target) {
      throw new ApiError(`DevDigest did not start a run for agent '${agent.name}'. Retry run_agent_on_pr.`, {
        code: 'run_not_started',
      });
    }

    const outcome = await pollRunUntilTerminal(client, prId, target.run_id, pollOptions);

    if (outcome.kind === 'timeout') {
      return toolMessage(
        'The review run did not finish within 180s. It may still be running — call get_findings(repo, pr) shortly to fetch the result.',
        { verdict: null, score: null, summary: null, findings: [] },
      );
    }

    if (outcome.kind === 'failed') {
      throw new ApiError(
        `The review run for agent '${agent.name}' failed: ${outcome.run.error}. Check the run in DevDigest, or retry run_agent_on_pr.`,
        { code: 'run_failed' },
      );
    }

    if (outcome.kind === 'cancelled') {
      throw new ApiError(
        `The review run for agent '${agent.name}' was cancelled. Check the run in DevDigest, or retry run_agent_on_pr.`,
        { code: 'run_cancelled' },
      );
    }

    const reviews = await client.get<ReviewApiRecord[]>(`/pulls/${prId}/reviews`);
    const record = reviews.find((r) => r.run_id === outcome.run.run_id);
    if (!record) {
      throw new ApiError(
        `The review run for agent '${agent.name}' finished but no review was found for it. Retry get_findings(repo, pr).`,
        { code: 'review_missing' },
      );
    }

    return toolOk(toReviewResult(record));
  });
}
