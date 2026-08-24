import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ApiError } from '../http/client.js';

/**
 * Shared shaping for every tool's `CallToolResult` — see the plan's
 * "Error-message design": tool-execution errors are normal results with
 * `isError: true` (never a bare status code), and every message names the
 * next tool/action to call.
 */

/** A successful result. `structuredContent` must satisfy the tool's
 * `outputSchema` — the SDK validates it and throws an MCP protocol error if
 * it doesn't (see `@modelcontextprotocol/sdk` `validateToolOutput`). */
export function toolOk(structuredContent: Record<string, unknown>, text?: string): CallToolResult {
  return {
    content: [{ type: 'text', text: text ?? JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

/**
 * A "normal" (non-error) result carrying only a message — used for
 * `run_agent_on_pr`'s poll-timeout and `get_blast_radius`'s
 * degraded/flag_off cases, which are explicitly NOT errors per the plan.
 * `structuredContent` defaults to `{}`; pass one that matches the tool's
 * outputSchema when it has required fields with no natural placeholder.
 */
export function toolMessage(message: string, structuredContent: Record<string, unknown> = {}): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    structuredContent,
    isError: false,
  };
}

/** An error result: `isError: true`. The output-schema validator skips
 * `isError` results, so no `structuredContent` is needed here. */
export function toolError(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Runs `fn`, converting a thrown `ApiError` into a `toolError` result so
 * every tool handler gets uniform error handling for free. Any other thrown
 * error is a bug, not a user-facing state, so it is rethrown as-is. */
export async function runTool(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) return toolError(err.message);
    throw err;
  }
}
