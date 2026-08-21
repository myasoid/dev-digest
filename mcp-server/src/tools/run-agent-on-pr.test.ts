import { describe, it, expect, vi } from 'vitest';
import type { ApiClient } from '../http/client.js';
import { runAgentOnPr } from './run-agent-on-pr.js';

function fakeClient(opts: {
  repos?: unknown;
  pulls?: unknown;
  agents?: unknown;
  postReview?: unknown;
  runsSequence?: unknown[][];
  reviews?: unknown;
}): ApiClient {
  let runsCall = 0;
  return {
    get: async (path: string) => {
      if (path === '/repos') return opts.repos ?? [];
      if (path === '/repos/repo-1/pulls') return opts.pulls ?? [];
      if (path === '/agents') return opts.agents ?? [];
      if (path === '/pulls/pr-1/runs') {
        const seq = opts.runsSequence ?? [];
        const rows = seq[Math.min(runsCall, seq.length - 1)] ?? [];
        runsCall += 1;
        return rows;
      }
      if (path === '/pulls/pr-1/reviews') return opts.reviews ?? [];
      throw new Error(`unexpected GET ${path}`);
    },
    post: async () => opts.postReview,
  } as unknown as ApiClient;
}

const repos = [{ id: 'repo-1', full_name: 'acme/payments-api' }];
const pulls = [{ id: 'pr-1', number: 482 }];
const agents = [{ id: 'agent-1', name: 'Security' }];

describe('runAgentOnPr', () => {
  it('starts a run, polls to done, and returns the review', async () => {
    const client = fakeClient({
      repos,
      pulls,
      agents,
      postReview: { runs: [{ run_id: 'run-1', agent_id: 'agent-1', agent_name: 'Security' }] },
      runsSequence: [[{ run_id: 'run-1', agent_id: 'agent-1', agent_name: 'Security', status: 'done', error: null }]],
      reviews: [
        {
          run_id: 'run-1',
          kind: 'review',
          verdict: 'request_changes',
          summary: 'found issues',
          score: 40,
          created_at: '2026-01-01T00:00:00.000Z',
          findings: [],
        },
      ],
    });

    const result = await runAgentOnPr(
      client,
      { repo: 'acme/payments-api', pr: 482, agent: 'security' },
      { sleep: vi.fn() },
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      verdict: 'request_changes',
      score: 40,
      summary: 'found issues',
      findings: [],
    });
  });

  it('returns the poll-timeout message as a non-error result', async () => {
    const client = fakeClient({
      repos,
      pulls,
      agents,
      postReview: { runs: [{ run_id: 'run-1', agent_id: 'agent-1', agent_name: 'Security' }] },
      runsSequence: [[{ run_id: 'run-1', agent_id: 'agent-1', agent_name: 'Security', status: 'running', error: null }]],
    });

    let clock = 0;
    const result = await runAgentOnPr(
      client,
      { repo: 'acme/payments-api', pr: 482, agent: 'security' },
      {
        ceilingMs: 1000,
        intervalMs: 500,
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
      },
    );
    expect(result.isError).toBe(false);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: 'The review run did not finish within 180s. It may still be running — call get_findings(repo, pr) shortly to fetch the result.',
    });
    expect(result.structuredContent).toEqual({ verdict: null, score: null, summary: null, findings: [] });
  });

  it('errors with the run-failed message including RunSummary.error', async () => {
    const client = fakeClient({
      repos,
      pulls,
      agents,
      postReview: { runs: [{ run_id: 'run-1', agent_id: 'agent-1', agent_name: 'Security' }] },
      runsSequence: [
        [{ run_id: 'run-1', agent_id: 'agent-1', agent_name: 'Security', status: 'failed', error: 'model timeout' }],
      ],
    });

    const result = await runAgentOnPr(
      client,
      { repo: 'acme/payments-api', pr: 482, agent: 'security' },
      { sleep: vi.fn() },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: "The review run for agent 'Security' failed: model timeout. Check the run in DevDigest, or retry run_agent_on_pr.",
    });
  });

  it('errors with the unknown-agent message before starting a run', async () => {
    const client = fakeClient({ repos, pulls, agents });
    const result = await runAgentOnPr(client, { repo: 'acme/payments-api', pr: 482, agent: 'nope' });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: "Agent 'nope' not found. Call list_agents to see valid agent ids and names.",
    });
  });
});
