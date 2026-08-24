import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient, ApiError } from './client.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ApiClient', () => {
  const config = { baseUrl: 'http://localhost:3001', timeoutMs: 5000 };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns parsed JSON on a 2xx response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const client = new ApiClient(config);
    await expect(client.get('/agents')).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3001/agents',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('sends a JSON body on POST', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { pr_id: '1' }));
    const client = new ApiClient(config);
    await client.post('/pulls/1/review', { agentId: 'a1' });
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3001/pulls/1/review',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ agentId: 'a1' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
  });

  it('maps the server error envelope to a typed ApiError', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(404, { error: { code: 'not_found', message: 'Repo not found' } }),
    );
    const client = new ApiClient(config);
    await expect(client.get('/repos/x')).rejects.toMatchObject({
      name: 'ApiError',
      message: 'Repo not found',
      code: 'not_found',
      status: 404,
    });
  });

  it('falls back to a generic ApiError for a non-envelope error body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('oops', { status: 500 }));
    const client = new ApiClient(config);
    await expect(client.get('/repos')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'http_error',
      status: 500,
    });
  });

  it('maps a network failure to the forward-leading unreachable message', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('fetch failed'));
    const client = new ApiClient(config);
    await expect(client.get('/repos')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'network_error',
      message:
        'Could not reach the DevDigest API at http://localhost:3001. Start it with ./scripts/dev.sh, then retry.',
    });
  });

  it('ApiError carries code/status/details', () => {
    const err = new ApiError('boom', { code: 'x', status: 400, details: { a: 1 } });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('x');
    expect(err.status).toBe(400);
    expect(err.details).toEqual({ a: 1 });
  });
});
