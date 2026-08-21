import type { ApiClient } from './http/client.js';
import { ApiError } from './http/client.js';

/**
 * Resolvers turning the human-facing arguments tools accept (`repo` slug,
 * `pr` number, `agent` id/name) into the DevDigest-internal uuids the API
 * routes expect. Each throws a typed, forward-leading `ApiError` (never a
 * bare "not found") per the plan's "Error-message design" — the exact
 * message templates are reproduced verbatim here.
 */

/** The subset of `Repo` (`@devdigest/shared`) resolvers need. */
interface RepoLite {
  id: string;
  full_name: string;
}

/** The subset of `PrMeta` (`@devdigest/shared`) resolvers need. */
interface PrLite {
  id?: string | null;
  number: number;
}

/** The subset of `Agent` (`@devdigest/shared`) resolvers need. */
interface AgentLite {
  id: string;
  name: string;
}

/** `GET /repos` → match `Repo.full_name` (exact, case-sensitive — full_name is
 * GitHub's own owner/name casing). */
export async function resolveRepoId(client: ApiClient, repoSlug: string): Promise<string> {
  const repos = await client.get<RepoLite[]>('/repos');
  const match = repos.find((r) => r.full_name === repoSlug);
  if (!match) {
    throw new ApiError(
      `No imported repo matches '${repoSlug}'. Check the exact owner/name (full_name) shown in the DevDigest repos list.`,
      { code: 'repo_not_found' },
    );
  }
  return match.id;
}

/** `GET /repos/:id/pulls` → match `PrMeta.number`. `repoSlug` is only used to
 * word the not-found message; the lookup itself is by `repoId`. */
export async function resolvePrId(
  client: ApiClient,
  repoId: string,
  repoSlug: string,
  prNumber: number,
): Promise<string> {
  const pulls = await client.get<PrLite[]>(`/repos/${repoId}/pulls`);
  const match = pulls.find((p) => p.number === prNumber && p.id);
  if (!match?.id) {
    throw new ApiError(
      `PR #${prNumber} not found in ${repoSlug}. Open the PR list for this repo in DevDigest to see available PR numbers.`,
      { code: 'pr_not_found' },
    );
  }
  return match.id;
}

/** `GET /agents` → match `Agent.id` OR `Agent.name`, case-insensitive; id
 * takes priority over name on ambiguity (ids are uuids so real collisions
 * between an id-shaped ref and a name are not expected in practice, but this
 * keeps the precedence rule explicit and cheap to check first). */
export async function resolveAgent(client: ApiClient, agentRef: string): Promise<AgentLite> {
  const agents = await client.get<AgentLite[]>('/agents');
  const ref = agentRef.toLowerCase();
  const byId = agents.find((a) => a.id.toLowerCase() === ref);
  if (byId) return byId;
  const byName = agents.find((a) => a.name.toLowerCase() === ref);
  if (byName) return byName;
  throw new ApiError(`Agent '${agentRef}' not found. Call list_agents to see valid agent ids and names.`, {
    code: 'agent_not_found',
  });
}
