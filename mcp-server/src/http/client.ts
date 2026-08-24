import { loadHttpConfig, type HttpConfig } from './config.js';

export interface ApiErrorOptions {
  /** Machine-readable code: the server's own `error.code`, or a client-side
   * one (`network_error`, `http_error`) when the server didn't send an envelope. */
  code: string;
  status?: number;
  details?: unknown;
}

/**
 * Typed error for any failed call to the DevDigest API — network failure,
 * timeout, or the server's own error envelope
 * (`{ error: { code, message, details } }`, see `server/src/app.ts`).
 *
 * `message` is always the forward-leading text a tool should surface verbatim
 * as its `isError: true` result — see the plan's "Error-message design".
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly details?: unknown;

  constructor(message: string, opts: ApiErrorOptions) {
    super(message);
    this.name = 'ApiError';
    this.code = opts.code;
    this.status = opts.status;
    this.details = opts.details;
  }
}

interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const err = (value as { error?: unknown }).error;
  return typeof err === 'object' && err !== null && 'code' in err && 'message' in err;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Thin `fetch`-based JSON client for the DevDigest API. No auth headers — the
 * server has no auth middleware in local dev (`LocalNoAuthProvider` always
 * resolves the single seeded workspace); see `mcp-server/README.md`.
 */
export class ApiClient {
  private readonly config: HttpConfig;

  constructor(config: HttpConfig = loadHttpConfig()) {
    this.config = config;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch {
      // Covers both connection failure (server not running) and our own
      // abort-on-timeout — from the caller's side both mean "couldn't reach it".
      throw new ApiError(
        `Could not reach the DevDigest API at ${this.config.baseUrl}. Start it with ./scripts/dev.sh, then retry.`,
        { code: 'network_error' },
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    const json = text.length > 0 ? safeJsonParse(text) : undefined;

    if (!res.ok) {
      if (isErrorEnvelope(json)) {
        throw new ApiError(json.error.message, {
          code: json.error.code,
          status: res.status,
          details: json.error.details,
        });
      }
      throw new ApiError(
        `DevDigest API request failed: ${method} ${path} -> ${res.status} ${res.statusText}`,
        { code: 'http_error', status: res.status },
      );
    }

    return json as T;
  }
}
