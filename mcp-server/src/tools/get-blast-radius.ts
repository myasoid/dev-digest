import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ApiClient } from '../http/client.js';
import { resolveRepoId } from '../resolve.js';
import { BlastRadiusOutput } from '../schemas.js';
import { runTool, toolOk, toolMessage } from './result.js';

export interface GetBlastRadiusArgs {
  repo: string;
  changed_files: string[];
}

/**
 * Wraps `POST /repos/:id/blast` (Phase 1, step 3 of the plan) — gated on that
 * route existing, but this tool has no runtime dependency on it: tests mock
 * `fetch` against the documented request/response contract.
 *
 * `degraded: true` is NOT an error — returns a normal (`isError: false`)
 * result carrying the exact degraded/flag_off message from the plan's
 * "Error-message design", with the (possibly-empty) real payload still in
 * `structuredContent`.
 */
export async function getBlastRadius(client: ApiClient, args: GetBlastRadiusArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const repoId = await resolveRepoId(client, args.repo);
    const raw = await client.post<unknown>(`/repos/${repoId}/blast`, { changed_files: args.changed_files });
    const result = BlastRadiusOutput.parse(raw);

    if (result.degraded) {
      const message =
        result.reason === 'flag_off'
          ? 'Blast radius is disabled: REPO_INTEL_ENABLED is off on the server. Enable it and restart the API to get real blast data.'
          : `Blast radius is degraded (reason: ${result.reason}) — this repo isn't fully indexed, so callers/impact may be incomplete. Trigger indexing with a resync in DevDigest (POST /repos/:id/resync) and retry.`;
      return toolMessage(message, result);
    }

    return toolOk(result);
  });
}
