import { describe, it, expect } from 'vitest';
import type { ApiClient } from '../http/client.js';
import { ApiError } from '../http/client.js';
import { listAgents } from './list-agents.js';

function fakeClient(get: (path: string) => Promise<unknown>): ApiClient {
  return { get } as unknown as ApiClient;
}

describe('listAgents', () => {
  it('maps GET /agents rows to the ListAgentsOutput shape', async () => {
    const client = fakeClient(async () => [
      {
        id: 'a1',
        name: 'Security',
        description: 'Looks for security issues',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        system_prompt: 'be secure',
        enabled: true,
      },
    ]);

    const result = await listAgents(client);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      agents: [
        {
          id: 'a1',
          name: 'Security',
          description: 'Looks for security issues',
          model: 'claude-sonnet-4-5',
          enabled: true,
        },
      ],
    });
  });

  it('surfaces an ApiError as an isError result', async () => {
    const client = fakeClient(async () => {
      throw new ApiError('Could not reach the DevDigest API at http://localhost:3001. Start it with ./scripts/dev.sh, then retry.', {
        code: 'network_error',
      });
    });
    const result = await listAgents(client);
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('Could not reach') });
  });

  it('lets unexpected errors propagate', async () => {
    const client = fakeClient(async () => {
      throw new Error('boom');
    });
    await expect(listAgents(client)).rejects.toThrow('boom');
  });
});
