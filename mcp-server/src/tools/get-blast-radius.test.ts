import { describe, it, expect } from 'vitest';
import type { ApiClient } from '../http/client.js';
import { getBlastRadius } from './get-blast-radius.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A minimal valid PrBlastMap payload (status: ok). */
function prBlastOk() {
  return {
    status: 'ok',
    explanation: null,
    reason: null,
    indexedSha: 'abc1234',
    stale: false,
    symbols: [
      {
        file: 'src/a.ts',
        name: 'foo',
        kind: 'function',
        callers: [{ file: 'src/b.ts', symbol: 'bar', viaSymbol: 'foo', line: 10, rank: 3 }],
        callerCount: 1,
        truncated: false,
      },
    ],
    symbolsTruncated: false,
    endpoints: [{ label: 'GET /api/foo', viaFiles: ['src/b.ts'], depth: 1 }],
    crons: [],
    priorPrs: [
      { number: 100, title: 'Refactor payment flow', url: 'https://github.com/acme/payments-api/pull/100', sharedFiles: ['src/a.ts'] },
    ],
    counts: { symbols: 1, callers: 1, endpoints: 1, crons: 0 },
  };
}

/** A minimal valid PrBlastMap payload (status: partial). */
function prBlastPartial() {
  return {
    ...prBlastOk(),
    status: 'partial',
    explanation: 'The index is 4 commits behind this PR\'s head; callers are resolved against `abc1234`.',
    stale: true,
  };
}

/** A minimal valid PrBlastMap payload (status: degraded). */
function prBlastDegraded() {
  return {
    status: 'degraded',
    explanation: 'Blast radius is degraded (reason: no_data) — this repo isn\'t fully indexed.',
    reason: 'no_data',
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

/** Fake API client supporting both changed_files (POST) and pr (GET) forms. */
function fakeClient(opts: {
  repos?: unknown;
  blast?: unknown;          // POST /repos/:id/blast response
  prBlast?: unknown;        // GET /pulls/:id/blast response
  pulls?: unknown;          // GET /repos/:id/pulls response
}): ApiClient {
  return {
    get: async (path: string) => {
      if (path === '/repos') return opts.repos ?? [{ id: 'repo-1', full_name: 'acme/payments-api' }];
      if (path === '/repos/repo-1/pulls') return opts.pulls ?? [{ id: 'pr-uuid-482', number: 482 }];
      if (path === '/pulls/pr-uuid-482/blast') return opts.prBlast ?? prBlastOk();
      throw new Error(`unexpected GET ${path}`);
    },
    post: async (path: string, body: unknown) => {
      if (path === '/repos/repo-1/blast') {
        expect(body).toMatchObject({ changed_files: expect.any(Array) });
        return opts.blast ?? { changedSymbols: [], callers: [], impactedEndpoints: [] };
      }
      throw new Error(`unexpected POST ${path}`);
    },
  } as unknown as ApiClient;
}

const repos = [{ id: 'repo-1', full_name: 'acme/payments-api' }];

// ---------------------------------------------------------------------------
// changed_files form (existing) — must still pass unchanged
// ---------------------------------------------------------------------------

describe('getBlastRadius — changed_files form (existing, backward-compatible)', () => {
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

// ---------------------------------------------------------------------------
// pr form (Phase 3 addition)
// ---------------------------------------------------------------------------

describe('getBlastRadius — pr form (Phase 3)', () => {
  it('pr form with numeric pr + repo: calls GET /pulls/:id/blast and returns PrBlastMap (ok)', async () => {
    const client = fakeClient({ repos, prBlast: prBlastOk() });
    const result = await getBlastRadius(client, { repo: 'acme/payments-api', pr: 482 });

    expect(result.isError).toBeUndefined();
    // structuredContent holds the full PrBlastMap.
    expect(result.structuredContent).toMatchObject({
      status: 'ok',
      symbols: expect.arrayContaining([expect.objectContaining({ name: 'foo' })]),
      priorPrs: expect.arrayContaining([expect.objectContaining({ number: 100 })]),
    });
  });

  it('pr form with "owner/name#number" short form: resolves both repo and PR', async () => {
    const client = fakeClient({ repos, prBlast: prBlastOk() });
    const result = await getBlastRadius(client, { pr: 'acme/payments-api#482' });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ status: 'ok' });
  });

  it('pr form partial: returns toolOk with explanation surfaced in text content', async () => {
    const client = fakeClient({ repos, prBlast: prBlastPartial() });
    const result = await getBlastRadius(client, { repo: 'acme/payments-api', pr: 482 });

    // partial is NOT an error — it returns the data.
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ status: 'partial' });
    // explanation must appear in the text so the model knows the map is incomplete.
    const text = result.content[0];
    expect(text).toMatchObject({ type: 'text' });
    expect((text as { text: string }).text).toContain('Note:');
    expect((text as { text: string }).text).toContain('abc1234');
  });

  it('pr form degraded: returns toolMessage (non-error) with explanation in text, empty data in structuredContent', async () => {
    const client = fakeClient({ repos, prBlast: prBlastDegraded() });
    const result = await getBlastRadius(client, { repo: 'acme/payments-api', pr: 482 });

    // degraded is non-error (toolMessage pattern).
    expect(result.isError).toBe(false);
    const text = result.content[0];
    expect(text).toMatchObject({ type: 'text' });
    expect((text as { text: string }).text).toContain('degraded');
    // structuredContent must be present (not empty {}) to satisfy outputSchema.
    expect(result.structuredContent).toMatchObject({ status: 'degraded', symbols: [] });
  });

  it('pr form: errors when repo does not resolve', async () => {
    const client = fakeClient({ repos: [] });
    const result = await getBlastRadius(client, { repo: 'nope/nope', pr: 482 });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect((result.content[0] as { text: string }).text).toContain('nope/nope');
  });

  it('pr form: errors when PR number does not resolve', async () => {
    const client = fakeClient({ repos, pulls: [] });
    const result = await getBlastRadius(client, { repo: 'acme/payments-api', pr: 9999 });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('9999');
  });

  it('pr form takes precedence over changed_files when both are given', async () => {
    // When pr is set, it must call the pr route, not the POST blast route.
    let postCalled = false;
    const client: ApiClient = {
      get: async (path: string) => {
        if (path === '/repos') return repos;
        if (path === '/repos/repo-1/pulls') return [{ id: 'pr-uuid-482', number: 482 }];
        if (path === '/pulls/pr-uuid-482/blast') return prBlastOk();
        throw new Error(`unexpected GET ${path}`);
      },
      post: async () => {
        postCalled = true;
        return {};
      },
    } as unknown as ApiClient;

    const result = await getBlastRadius(client, {
      repo: 'acme/payments-api',
      pr: 482,
      changed_files: ['src/a.ts'],
    });
    expect(result.isError).toBeUndefined();
    expect(postCalled).toBe(false); // pr form used GET, not POST
    expect(result.structuredContent).toMatchObject({ status: 'ok' });
  });
});
