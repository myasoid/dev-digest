import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ApiClient } from './http/client.js';
import { BlastRadiusOutput, GetConventionsOutput, ListAgentsOutput, PrBlastMap, ReviewResult } from './schemas.js';
import { getBlastRadius } from './tools/get-blast-radius.js';
import { getConventions } from './tools/get-conventions.js';
import { getFindings } from './tools/get-findings.js';
import { listAgents } from './tools/list-agents.js';
import { runAgentOnPr } from './tools/run-agent-on-pr.js';

/**
 * Registers the 5 tools from `mcp-server/specs/development-plan.md`
 * ("Tool specifications — FINAL, verbatim"). The `description` strings below
 * are copied character-for-character from that file — do not edit them here
 * without updating the plan first.
 */
export function createServer(client: ApiClient): McpServer {
  const server = new McpServer({ name: 'devdigest-mcp-server', version: '0.0.0' });

  server.registerTool(
    'list_agents',
    {
      description:
        'List the reviewer agents configured in this DevDigest workspace. Call this first to get valid agent ids/names before calling run_agent_on_pr.',
      inputSchema: {},
      outputSchema: ListAgentsOutput.shape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => listAgents(client),
  );

  server.registerTool(
    'run_agent_on_pr',
    {
      description:
        'Run a specific reviewer agent on a pull request and wait for the finished review. Starts the run, polls until it completes (up to 3 minutes), and returns the verdict and findings in one call — you do not need to poll or fetch findings separately.',
      inputSchema: {
        repo: z.string().describe('owner/name, e.g. acme/payments-api'),
        pr: z.number().int().describe('PR number, e.g. 482'),
        agent: z.string().describe('agent id or name from list_agents, case-insensitive'),
      },
      outputSchema: ReviewResult.shape,
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => runAgentOnPr(client, args),
  );

  server.registerTool(
    'get_findings',
    {
      description:
        'Get the verdict and findings from the most recent completed review of a pull request, without starting a new run. Use this to check results from a run_agent_on_pr call made earlier, or from any review already run in DevDigest.',
      inputSchema: {
        repo: z.string(),
        pr: z.number().int(),
      },
      outputSchema: ReviewResult.shape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => getFindings(client, args),
  );

  server.registerTool(
    'get_conventions',
    {
      description:
        'Get the coding conventions already detected for a repository (naming, style, structure rules with evidence). Read-only — does not trigger new analysis.',
      inputSchema: { repo: z.string() },
      outputSchema: GetConventionsOutput.shape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => getConventions(client, args),
  );

  server.registerTool(
    'get_blast_radius',
    {
      description:
        "Get the blast-radius impact map for a repository. Two forms:\n" +
        "1. changed_files form (existing): pass `repo` (owner/name) and `changed_files` → calls POST /repos/:id/blast and returns a BlastRadiusOutput.\n" +
        "2. pr form (Phase 3): pass `repo` and `pr` (PR number) OR pass `pr` as 'owner/name#number' → calls GET /pulls/:id/blast and returns a PrBlastMap with per-symbol caller details, prior PRs, and a tri-state status. For a partial result, the explanation field names what is incomplete.\n" +
        "Both forms return a non-error result for degraded/partial indexes; the text content explains the condition.",
      inputSchema: {
        repo: z
          .string()
          .optional()
          .describe(
            'owner/name slug, e.g. "acme/payments-api". Required for the changed_files form. Optional for the pr form when pr is given as "owner/name#number".',
          ),
        changed_files: z
          .array(z.string())
          .optional()
          .describe('Changed file paths. When present, calls POST /repos/:id/blast (existing form).'),
        pr: z
          .union([z.number().int(), z.string()])
          .optional()
          .describe(
            'PR number or "owner/name#number". When present, calls GET /pulls/:id/blast (Phase 3 form). Takes precedence over changed_files.',
          ),
      },
      // The outputSchema covers both response shapes (BlastRadiusOutput and
      // PrBlastMap) by making all fields optional. The text content always has the
      // full readable output; structuredContent is present for programmatic use.
      outputSchema: {
        ...BlastRadiusOutput.partial().shape,
        ...PrBlastMap.partial().shape,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => getBlastRadius(client, args),
  );

  return server;
}
