import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ApiClient } from '../http/client.js';
import { resolveRepoId } from '../resolve.js';
import { GetConventionsOutput } from '../schemas.js';
import { runTool, toolOk } from './result.js';

export interface GetConventionsArgs {
  repo: string;
}

/** The subset of `ConventionScan` (`@devdigest/shared`) this tool needs. */
interface ConventionsApiResponse {
  scanned_at: string | null;
  candidates: Array<{
    category: string;
    rule: string;
    evidence_path: string;
    evidence_start_line: number;
    evidence_end_line: number;
    confidence: number;
    accepted: boolean;
  }>;
}

/** Wraps `GET /repos/:id/conventions` (`server/src/modules/conventions/routes.ts:26-29`).
 * Read-only — never triggers `POST /repos/:id/conventions/extract`. */
export async function getConventions(client: ApiClient, args: GetConventionsArgs): Promise<CallToolResult> {
  return runTool(async () => {
    const repoId = await resolveRepoId(client, args.repo);
    const scan = await client.get<ConventionsApiResponse>(`/repos/${repoId}/conventions`);
    const output = GetConventionsOutput.parse({
      scanned_at: scan.scanned_at,
      candidates: scan.candidates.map((c) => ({
        category: c.category,
        rule: c.rule,
        evidence_path: c.evidence_path,
        evidence_start_line: c.evidence_start_line,
        evidence_end_line: c.evidence_end_line,
        confidence: c.confidence,
        accepted: c.accepted,
      })),
    });
    return toolOk(output);
  });
}
