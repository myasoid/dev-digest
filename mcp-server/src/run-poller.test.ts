import { describe, it, expect, vi } from 'vitest';
import type { ApiClient } from './http/client.js';
import { pollRunUntilTerminal } from './run-poller.js';

function fakeClient(responses: unknown[][]): ApiClient {
  const get = vi.fn();
  for (const r of responses) get.mockResolvedValueOnce(r);
  return { get } as unknown as ApiClient;
}

const baseRun = { run_id: 'run-1', agent_id: 'a1', agent_name: 'Security', error: null };

describe('pollRunUntilTerminal', () => {
  it('returns done as soon as the run reaches a done status', async () => {
    const client = fakeClient([[{ ...baseRun, status: 'running' }], [{ ...baseRun, status: 'done' }]]);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const outcome = await pollRunUntilTerminal(client, 'pr-1', 'run-1', { sleep });
    expect(outcome).toEqual({ kind: 'done', run: { ...baseRun, status: 'done' } });
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('returns failed with the run error', async () => {
    const client = fakeClient([[{ ...baseRun, status: 'failed', error: 'model timeout' }]]);
    const outcome = await pollRunUntilTerminal(client, 'pr-1', 'run-1', { sleep: vi.fn() });
    expect(outcome).toEqual({
      kind: 'failed',
      run: { ...baseRun, status: 'failed', error: 'model timeout' },
    });
  });

  it('returns cancelled', async () => {
    const client = fakeClient([[{ ...baseRun, status: 'cancelled' }]]);
    const outcome = await pollRunUntilTerminal(client, 'pr-1', 'run-1', { sleep: vi.fn() });
    expect(outcome.kind).toBe('cancelled');
  });

  it('returns timeout once the ceiling elapses without a terminal status', async () => {
    let clock = 0;
    const now = () => clock;
    const sleep = vi.fn().mockImplementation(async (ms: number) => {
      clock += ms;
    });
    // Always-running: the poller keeps fetching until the ceiling elapses,
    // however many fetches that takes.
    const get = vi.fn().mockResolvedValue([{ ...baseRun, status: 'running' }]);
    const client = { get } as unknown as ApiClient;
    const outcome = await pollRunUntilTerminal(client, 'pr-1', 'run-1', {
      intervalMs: 2000,
      ceilingMs: 5000,
      sleep,
      now,
    });
    expect(outcome).toEqual({ kind: 'timeout' });
  });

  it('ignores rows for other runs and rows that fail to parse', async () => {
    const client = fakeClient([
      [{ not: 'a run summary' }, { ...baseRun, run_id: 'other-run', status: 'done' }, { ...baseRun, status: 'done' }],
    ]);
    const outcome = await pollRunUntilTerminal(client, 'pr-1', 'run-1', { sleep: vi.fn() });
    expect(outcome).toEqual({ kind: 'done', run: { ...baseRun, status: 'done' } });
  });
});
