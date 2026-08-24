import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ApiClient } from '../http/client.js';
import { resolveRepoId, resolvePrId } from '../resolve.js';
import { BlastRadiusOutput, PrBlastMap } from '../schemas.js';
import { runTool, toolOk, toolMessage } from './result.js';

/**
 * Two forms of the tool (backward-compatible):
 *
 * 1. `changed_files` form (existing):
 *    `{ repo: "owner/name", changed_files: ["src/a.ts"] }`
 *    Calls `POST /repos/:id/blast` and returns `BlastRadiusOutput`.
 *
 * 2. `pr` form (Phase 3 addition):
 *    `{ repo: "owner/name", pr: 482 }` OR
 *    `{ pr: "owner/name#482" }` (short form, no `repo` needed)
 *    Calls `GET /pulls/:id/blast` and returns `PrBlastMap`.
 *
 * PR addressing decision (recorded in Phase 3 implementation report):
 * The route takes a PR UUID internally, but a reviewer has the GitHub PR number.
 * `resolvePrId(client, repoId, slug, number)` already resolves a PR number to a
 * UUID via `GET /repos/:id/pulls` — it was written for `run_agent_on_pr` and is
 * exactly the right lookup here. Supporting the `owner/name#number` short form
 * avoids the need to also pass `repo` separately. Both forms are accepted.
 *
 * Status handling for the PR form:
 * - `ok`      → toolOk(result)
 * - `partial` → toolOk(result) but `explanation` is surfaced in the text so the
 *               model consuming it knows the map is incomplete. Silently returning
 *               a partial map as if complete is the defect this feature exists to
 *               prevent.
 * - `degraded`→ toolMessage with the explanation (non-error, same pattern as the
 *               existing changed_files form).
 */

export interface GetBlastRadiusArgs {
  /** owner/name slug, e.g. "acme/payments-api". Required for the changed_files
   *  form. Optional for the pr form when `pr` is given as "owner/name#number". */
  repo?: string;
  /** Changed file paths (existing form). When present, calls POST /repos/:id/blast. */
  changed_files?: string[];
  /** PR number (pr form). When present (with `repo`), calls GET /pulls/:id/blast.
   *  Also accepts "owner/name#number" as a self-contained slug. */
  pr?: number | string;
}

/**
 * Wraps `POST /repos/:id/blast` (changed_files form) or `GET /pulls/:id/blast`
 * (pr form). Both forms are supported simultaneously — this is a backward-compatible
 * addition. Existing `changed_files` callers are unaffected.
 */
export async function getBlastRadius(client: ApiClient, args: GetBlastRadiusArgs): Promise<CallToolResult> {
  return runTool(async () => {
    // Determine which form was invoked.
    if (args.pr !== undefined) {
      return handlePrForm(client, args);
    }
    // Fall through to the existing changed_files form.
    return handleChangedFilesForm(client, args);
  });
}

// ---------------------------------------------------------------------------
// PR form: GET /pulls/:id/blast → PrBlastMap
// ---------------------------------------------------------------------------

async function handlePrForm(client: ApiClient, args: GetBlastRadiusArgs): Promise<CallToolResult> {
  // Parse the pr argument: either a number (with `repo`) or "owner/name#number".
  let repoSlug: string;
  let prNumber: number;

  if (typeof args.pr === 'string' && args.pr.includes('#')) {
    // Short form: "owner/name#482"
    const [slug, numStr] = args.pr.split('#') as [string, string];
    repoSlug = slug;
    prNumber = parseInt(numStr, 10);
  } else if (typeof args.pr === 'number') {
    if (!args.repo) {
      throw new Error('`repo` is required when `pr` is a number. Pass "owner/name#number" to avoid the separate `repo` argument.');
    }
    repoSlug = args.repo;
    prNumber = args.pr;
  } else if (typeof args.pr === 'string') {
    // Numeric string without '#'
    if (!args.repo) {
      throw new Error('`repo` is required when `pr` is a number string. Pass "owner/name#number" to avoid the separate `repo` argument.');
    }
    repoSlug = args.repo;
    prNumber = parseInt(args.pr, 10);
  } else {
    throw new Error('`pr` must be a PR number or "owner/name#number".');
  }

  if (isNaN(prNumber)) {
    throw new Error(`Invalid PR number in '${String(args.pr)}'.`);
  }

  const repoId = await resolveRepoId(client, repoSlug);
  const prId = await resolvePrId(client, repoId, repoSlug, prNumber);

  const raw = await client.get<unknown>(`/pulls/${prId}/blast`);
  const result = PrBlastMap.parse(raw);

  if (result.status === 'degraded') {
    const message = result.explanation
      ?? `Blast radius is degraded (reason: ${result.reason ?? 'no_data'}) — this repo isn't fully indexed. Trigger indexing with a resync in DevDigest (POST /repos/:id/resync) and retry.`;
    // Pass a structured placeholder that satisfies the outputSchema's required fields.
    return toolMessage(message, buildPrBlastPlaceholder(result));
  }

  if (result.status === 'partial') {
    // Surface the explanation alongside the data so the model knows the map is
    // incomplete. Silently returning partial data as if complete is the defect
    // this feature exists to prevent.
    const text = result.explanation
      ? `Note: ${result.explanation}\n\n${JSON.stringify(result, null, 2)}`
      : JSON.stringify(result, null, 2);
    return toolOk(result as unknown as Record<string, unknown>, text);
  }

  return toolOk(result as unknown as Record<string, unknown>);
}

/**
 * Build a placeholder structured content object that satisfies PrBlastMap's
 * required fields for the degraded toolMessage path.
 */
function buildPrBlastPlaceholder(result: ReturnType<typeof PrBlastMap.parse>): Record<string, unknown> {
  return {
    status: result.status,
    explanation: result.explanation,
    reason: result.reason,
    indexedSha: null,
    stale: false,
    symbols: [],
    symbolsTruncated: false,
    endpoints: [],
    crons: [],
    priorPrs: [],
    counts: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
  };
}

// ---------------------------------------------------------------------------
// Existing changed_files form: POST /repos/:id/blast → BlastRadiusOutput
// ---------------------------------------------------------------------------

async function handleChangedFilesForm(client: ApiClient, args: GetBlastRadiusArgs): Promise<CallToolResult> {
  if (!args.repo) {
    throw new Error('`repo` is required when using the changed_files form.');
  }
  const changedFiles = args.changed_files ?? [];
  const repoId = await resolveRepoId(client, args.repo);
  const raw = await client.post<unknown>(`/repos/${repoId}/blast`, { changed_files: changedFiles });
  const result = BlastRadiusOutput.parse(raw);

  if (result.degraded) {
    const message =
      result.reason === 'flag_off'
        ? 'Blast radius is disabled: REPO_INTEL_ENABLED is off on the server. Enable it and restart the API to get real blast data.'
        : `Blast radius is degraded (reason: ${result.reason}) — this repo isn't fully indexed, so callers/impact may be incomplete. Trigger indexing with a resync in DevDigest (POST /repos/:id/resync) and retry.`;
    return toolMessage(message, result as unknown as Record<string, unknown>);
  }

  return toolOk(result as unknown as Record<string, unknown>);
}
