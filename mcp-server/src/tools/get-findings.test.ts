import { describe, it, expect } from 'vitest';
import type { ApiClient } from '../http/client.js';
import { getFindings } from './get-findings.js';

function fakeClient(byPath: Record<string, unknown>): ApiClient {
  // Longest prefix first so e.g. '/repos/repo-1/pulls' doesn't match '/repos'.
  const prefixes = Object.keys(byPath).sort((a, b) => b.length - a.length);
  return {
    get: async (path: string) => {
      for (const prefix of prefixes) {
        if (path.startsWith(prefix)) return byPath[prefix];
      }
      throw new Error(`unexpected GET ${path}`);
    },
  } as unknown as ApiClient;
}

describe('getFindings', () => {
  it('returns the most recently created "review"-kind review', async () => {
    const client = fakeClient({
      '/repos': [{ id: 'repo-1', full_name: 'acme/payments-api' }],
      '/repos/repo-1/pulls': [{ id: 'pr-1', number: 482 }],
      '/pulls/pr-1/reviews': [
        {
          run_id: 'run-old',
          kind: 'review',
          verdict: 'comment',
          summary: 'old',
          score: 70,
          created_at: '2026-01-01T00:00:00.000Z',
          findings: [],
        },
        {
          run_id: 'run-new',
          kind: 'review',
          verdict: 'approve',
          summary: 'new',
          score: 95,
          created_at: '2026-01-02T00:00:00.000Z',
          findings: [
            {
              severity: 'WARNING',
              category: 'style',
              title: 'nit',
              file: 'a.ts',
              start_line: 1,
              end_line: 2,
              rationale: 'because',
            },
          ],
        },
        {
          run_id: 'run-summary',
          kind: 'summary',
          verdict: 'approve',
          summary: 'not this one',
          score: 100,
          created_at: '2026-01-03T00:00:00.000Z',
          findings: [],
        },
      ],
    });

    const result = await getFindings(client, { repo: 'acme/payments-api', pr: 482 });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      verdict: 'approve',
      score: 95,
      summary: 'new',
      findings: [
        {
          severity: 'WARNING',
          category: 'style',
          title: 'nit',
          file: 'a.ts',
          start_line: 1,
          end_line: 2,
          rationale: 'because',
        },
      ],
    });
  });

  it('errors with the forward-leading no-reviews-yet message', async () => {
    const client = fakeClient({
      '/repos': [{ id: 'repo-1', full_name: 'acme/payments-api' }],
      '/repos/repo-1/pulls': [{ id: 'pr-1', number: 482 }],
      '/pulls/pr-1/reviews': [],
    });

    const result = await getFindings(client, { repo: 'acme/payments-api', pr: 482 });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: 'No completed reviews for PR #482 in acme/payments-api yet. Run one with run_agent_on_pr(repo, pr, agent).',
    });
  });

  it('errors when the repo does not resolve', async () => {
    const client = fakeClient({ '/repos': [] });
    const result = await getFindings(client, { repo: 'acme/payments-api', pr: 482 });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining("No imported repo matches 'acme/payments-api'"),
    });
  });
});
