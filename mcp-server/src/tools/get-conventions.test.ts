import { describe, it, expect } from 'vitest';
import type { ApiClient } from '../http/client.js';
import { getConventions } from './get-conventions.js';

function fakeClient(byPath: Record<string, unknown>): ApiClient {
  // Longest prefix first so e.g. '/repos/repo-1/conventions' doesn't match '/repos'.
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

describe('getConventions', () => {
  it('maps the ConventionScan response to the tool output shape', async () => {
    const client = fakeClient({
      '/repos': [{ id: 'repo-1', full_name: 'acme/payments-api' }],
      '/repos/repo-1/conventions': {
        sampled_files: 12,
        scanned_at: '2026-01-01T00:00:00.000Z',
        candidates: [
          {
            id: 'c1',
            category: 'naming',
            rule: 'Use camelCase for variables',
            evidence_path: 'src/a.ts',
            evidence_start_line: 3,
            evidence_end_line: 3,
            evidence_snippet: 'const fooBar = 1;',
            confidence: 0.9,
            accepted: true,
          },
        ],
      },
    });

    const result = await getConventions(client, { repo: 'acme/payments-api' });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      scanned_at: '2026-01-01T00:00:00.000Z',
      candidates: [
        {
          category: 'naming',
          rule: 'Use camelCase for variables',
          evidence_path: 'src/a.ts',
          evidence_start_line: 3,
          evidence_end_line: 3,
          confidence: 0.9,
          accepted: true,
        },
      ],
    });
  });

  it('errors when the repo does not resolve', async () => {
    const client = fakeClient({ '/repos': [] });
    const result = await getConventions(client, { repo: 'nope/nope' });
    expect(result.isError).toBe(true);
  });
});
