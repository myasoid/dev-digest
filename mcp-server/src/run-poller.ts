import type { ApiClient } from './http/client.js';
import { RunStatusSummary, type RunStatusSummary as RunStatusSummaryType } from './schemas.js';

const DEFAULT_INTERVAL_MS = 2_000;
/** ~3 minutes, per the plan's confirmed decision. */
const DEFAULT_CEILING_MS = 180_000;

export type PollOutcome =
  | { kind: 'done'; run: RunStatusSummaryType }
  | { kind: 'failed'; run: RunStatusSummaryType }
  | { kind: 'cancelled'; run: RunStatusSummaryType }
  | { kind: 'timeout' };

export interface PollOptions {
  intervalMs?: number;
  ceilingMs?: number;
  /** Injectable for tests; defaults to a real timer-based delay. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock for tests; defaults to `Date.now`. */
  now?: () => number;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls `GET /pulls/:prId/runs` (`RunSummary[]`) every ~`intervalMs` until
 * `runId` reaches a terminal status (`done | failed | cancelled`) or
 * `ceilingMs` elapses. Hitting the ceiling returns `{ kind: 'timeout' }` — a
 * normal outcome, never a throw or an unbounded hang (see the plan's
 * `run_agent_on_pr` polling decision and its "Poll timeout" message).
 */
export async function pollRunUntilTerminal(
  client: ApiClient,
  prId: string,
  runId: string,
  opts: PollOptions = {},
): Promise<PollOutcome> {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const ceilingMs = opts.ceilingMs ?? DEFAULT_CEILING_MS;
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? Date.now;
  const deadline = now() + ceilingMs;

  for (;;) {
    const rows = await client.get<unknown[]>(`/pulls/${prId}/runs`);
    const run = rows
      .map((r) => RunStatusSummary.safeParse(r))
      .filter((p): p is { success: true; data: RunStatusSummaryType } => p.success)
      .map((p) => p.data)
      .find((r) => r.run_id === runId);

    if (run) {
      if (run.status === 'done') return { kind: 'done', run };
      if (run.status === 'failed') return { kind: 'failed', run };
      if (run.status === 'cancelled') return { kind: 'cancelled', run };
    }

    if (now() >= deadline) return { kind: 'timeout' };
    await sleep(intervalMs);
  }
}
