import { describe, it, expect } from 'vitest';
import type { ApiClient } from '../http/client.js';
import { getBlastRadius } from './get-blast-radius.js';

function fakeClient(opts: { repos?: unknown; blast: unknown }): ApiClient {
  return {
    get: async (path: string) => {
      if (path === '/repos') return opts.repos ?? [];
      throw new Error(`unexpected GET ${path}`);
    },
    post: async (path: string, body: unknown) => {
      if (path === '/repos/repo-1/blast') {
        expect(body).toEqual({ changed_files: ['src/a.ts'] });
        return opts.blast;
      }
      throw new Error(`unexpected POST ${path}`);
    },
  } as unknown as ApiClient;
}

const repos = [{ id: 'repo-1', full_name: 'acme/payments-api' }];

describe('getBlastRadius', () => {
  it('returns the full impact map on a non-degraded result', async () => {
    const client = fakeClient({
      repos,
      blast: {
        changedSymbols: [{ file: 'src/a.ts', name: 'foo', kind: 'function' }],
        callers: [{ file: 'src/b.ts', symbol: 'bar', viaSymbol: 'foo', line: 10, rank: 3 }],
        impactedEndpoints: ['GET /foo'],
        factsByFile: { 'src/b.ts': { endpoints: ['GET /foo'], crons: [] } },
      },
    });

    const result = await getBlastRadius(client, { repo: 'acme/payments-api', changed_files: ['src/a.ts'] });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      changedSymbols: [{ file: 'src/a.ts', name: 'foo', kind: 'function' }],
      impactedEndpoints: ['GET /foo'],
    });
  });

  it('returns a non-error result with the degraded message (not flag_off)', async () => {
    const client = fakeClient({
      repos,
      blast: { changedSymbols: [], callers: [], impactedEndpoints: [], degraded: true, reason: 'no_data' },
    });

    const result = await getBlastRadius(client, { repo: 'acme/payments-api', changed_files: ['src/a.ts'] });
    expect(result.isError).toBe(false);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: "Blast radius is degraded (reason: no_data) — this repo isn't fully indexed, so callers/impact may be incomplete. Trigger indexing with a resync in DevDigest (POST /repos/:id/resync) and retry.",
    });
  });

  it('returns a non-error result with the flag_off message', async () => {
    const client = fakeClient({
      repos,
      blast: { changedSymbols: [], callers: [], impactedEndpoints: [], degraded: true, reason: 'flag_off' },
    });

    const result = await getBlastRadius(client, { repo: 'acme/payments-api', changed_files: ['src/a.ts'] });
    expect(result.isError).toBe(false);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: 'Blast radius is disabled: REPO_INTEL_ENABLED is off on the server. Enable it and restart the API to get real blast data.',
    });
  });

  it('errors when the repo does not resolve', async () => {
    const client = fakeClient({ repos: [], blast: {} });
    const result = await getBlastRadius(client, { repo: 'nope/nope', changed_files: [] });
    expect(result.isError).toBe(true);
  });
});
