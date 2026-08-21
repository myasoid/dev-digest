/**
 * HTTP configuration for talking to the already-running DevDigest Fastify API.
 * Local-only: no auth headers, no remote transport — see README.md.
 */

export interface HttpConfig {
  /** Base URL of the DevDigest API, no trailing slash. */
  baseUrl: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
}

const DEFAULT_BASE_URL = 'http://localhost:3001';
const DEFAULT_TIMEOUT_MS = 15_000;

/** Reads `DEVDIGEST_API_URL` (default `http://localhost:3001`) and an optional
 * `DEVDIGEST_API_TIMEOUT_MS` override. `env` is injectable for tests. */
export function loadHttpConfig(env: NodeJS.ProcessEnv = process.env): HttpConfig {
  const rawBaseUrl = env.DEVDIGEST_API_URL?.trim() || DEFAULT_BASE_URL;
  const baseUrl = rawBaseUrl.replace(/\/+$/, '');
  const rawTimeout = env.DEVDIGEST_API_TIMEOUT_MS?.trim();
  const timeoutMs = rawTimeout && Number.isFinite(Number(rawTimeout)) ? Number(rawTimeout) : DEFAULT_TIMEOUT_MS;
  return { baseUrl, timeoutMs };
}
