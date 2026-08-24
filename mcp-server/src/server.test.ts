import { describe, it, expect } from 'vitest';
import type { ApiClient } from './http/client.js';
import { createServer } from './server.js';

/**
 * `_registeredTools` is a private field of `McpServer`, but TypeScript
 * privacy is compile-time only — accessing it here is the cheapest way to
 * assert the plan's verbatim tool descriptions/annotations actually made it
 * into the registered tools, without spinning up a real stdio transport.
 */
interface RegisteredToolInternals {
  description?: string;
  annotations?: Record<string, unknown>;
}
function registeredTools(server: ReturnType<typeof createServer>): Record<string, RegisteredToolInternals> {
  return (server as unknown as { _registeredTools: Record<string, RegisteredToolInternals> })._registeredTools;
}

describe('createServer', () => {
  const client = {} as ApiClient;
  const server = createServer(client);
  const tools = registeredTools(server);

  it('registers exactly the 5 plan tools', () => {
    expect(Object.keys(tools).sort()).toEqual(
      ['get_blast_radius', 'get_conventions', 'get_findings', 'list_agents', 'run_agent_on_pr'].sort(),
    );
  });

  it('uses the verbatim list_agents description and annotations', () => {
    expect(tools.list_agents?.description).toBe(
      'List the reviewer agents configured in this DevDigest workspace. Call this first to get valid agent ids/names before calling run_agent_on_pr.',
    );
    expect(tools.list_agents?.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
  });

  it('uses the verbatim run_agent_on_pr description and annotations', () => {
    expect(tools.run_agent_on_pr?.description).toBe(
      'Run a specific reviewer agent on a pull request and wait for the finished review. Starts the run, polls until it completes (up to 3 minutes), and returns the verdict and findings in one call — you do not need to poll or fetch findings separately.',
    );
    expect(tools.run_agent_on_pr?.annotations).toEqual({
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  it('uses the verbatim get_findings description and annotations', () => {
    expect(tools.get_findings?.description).toBe(
      'Get the verdict and findings from the most recent completed review of a pull request, without starting a new run. Use this to check results from a run_agent_on_pr call made earlier, or from any review already run in DevDigest.',
    );
    expect(tools.get_findings?.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
  });

  it('uses the verbatim get_conventions description and annotations', () => {
    expect(tools.get_conventions?.description).toBe(
      'Get the coding conventions already detected for a repository (naming, style, structure rules with evidence). Read-only — does not trigger new analysis.',
    );
    expect(tools.get_conventions?.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
  });

  it('uses the updated get_blast_radius description (Phase 3: pr form added) and annotations', () => {
    // Phase 3 added the pr form. The description now covers both the existing
    // changed_files form and the new pr form. Annotations are unchanged.
    const desc = tools.get_blast_radius?.description ?? '';
    // Both forms must be mentioned.
    expect(desc).toContain('changed_files');
    expect(desc).toContain('pr');
    // Status tri-state must be mentioned (the PR form's key addition).
    expect(desc).toContain('partial');
    expect(tools.get_blast_radius?.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
  });
});
