import { describe, it, expect } from 'vitest';
import type { ApiClient } from './http/client.js';
import { resolveRepoId, resolvePrId, resolveAgent } from './resolve.js';

function fakeClient(response: unknown): ApiClient {
  return { get: async () => response } as unknown as ApiClient;
}

describe('resolveRepoId', () => {
  it('matches Repo.full_name exactly', async () => {
    const client = fakeClient([{ id: 'r1', full_name: 'acme/payments-api' }]);
    await expect(resolveRepoId(client, 'acme/payments-api')).resolves.toBe('r1');
  });

  it('throws the forward-leading not-found message', async () => {
    const client = fakeClient([{ id: 'r1', full_name: 'acme/payments-api' }]);
    await expect(resolveRepoId(client, 'acme/payments')).rejects.toMatchObject({
      code: 'repo_not_found',
      message:
        "No imported repo matches 'acme/payments'. Check the exact owner/name (full_name) shown in the DevDigest repos list.",
    });
  });
});

describe('resolvePrId', () => {
  it('matches PrMeta.number', async () => {
    const client = fakeClient([{ id: 'pr1', number: 482 }]);
    await expect(resolvePrId(client, 'r1', 'acme/payments-api', 482)).resolves.toBe('pr1');
  });

  it('throws the forward-leading not-found message naming the repo slug', async () => {
    const client = fakeClient([{ id: 'pr1', number: 482 }]);
    await expect(resolvePrId(client, 'r1', 'acme/payments-api', 999)).rejects.toMatchObject({
      code: 'pr_not_found',
      message:
        'PR #999 not found in acme/payments-api. Open the PR list for this repo in DevDigest to see available PR numbers.',
    });
  });
});

describe('resolveAgent', () => {
  const agents = [
    { id: 'agent-uuid-1', name: 'Security' },
    { id: 'agent-uuid-2', name: 'Style' },
  ];

  it('matches by id, case-insensitively', async () => {
    const client = fakeClient(agents);
    await expect(resolveAgent(client, 'AGENT-UUID-1')).resolves.toEqual(agents[0]);
  });

  it('matches by name, case-insensitively', async () => {
    const client = fakeClient(agents);
    await expect(resolveAgent(client, 'security')).resolves.toEqual(agents[0]);
  });

  it('prefers id over name on ambiguity', async () => {
    const overlapping = [
      { id: 'style', name: 'Something Else' },
      { id: 'agent-uuid-2', name: 'style' },
    ];
    const client = fakeClient(overlapping);
    await expect(resolveAgent(client, 'style')).resolves.toEqual(overlapping[0]);
  });

  it('throws the forward-leading not-found message', async () => {
    const client = fakeClient(agents);
    await expect(resolveAgent(client, 'nope')).rejects.toMatchObject({
      code: 'agent_not_found',
      message: "Agent 'nope' not found. Call list_agents to see valid agent ids and names.",
    });
  });
});
