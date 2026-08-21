import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ApiClient } from '../http/client.js';
import { ListAgentsOutput } from '../schemas.js';
import { runTool, toolOk } from './result.js';

/** The subset of `Agent` (`@devdigest/shared`) this tool needs. */
interface AgentApiRow {
  id: string;
  name: string;
  description: string;
  model: string;
  enabled: boolean;
}

/** Wraps `GET /agents` (`server/src/modules/agents/routes.ts:74-77`). */
export async function listAgents(client: ApiClient): Promise<CallToolResult> {
  return runTool(async () => {
    const rows = await client.get<AgentApiRow[]>('/agents');
    const output = ListAgentsOutput.parse({
      agents: rows.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        model: a.model,
        enabled: a.enabled,
      })),
    });
    return toolOk(output);
  });
}
