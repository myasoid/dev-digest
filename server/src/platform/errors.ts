/**
 * Domain error taxonomy + structured API error envelope. The UX taxonomy
 * (toast/inline/full-screen) is the frontend's concern; the API returns a
 * stable structured body (ApiErrorBody): { error: { code, message, details } }.
 */

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', details?: unknown) {
    super('not_found', message, 404, details);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super('validation_error', message, 422, details);
  }
}

/**
 * A repository-scoped action needs a local working copy and none exists yet
 * (`repos.clone_path IS NULL`). A DISTINCT code from `validation_error`
 * (R-3): AC-6 requires the client to tell "not synced" apart from an empty
 * result, and `ApiError.code` (`client/src/lib/api.ts`) is the field it
 * branches on — collapsing this into `ValidationError` would make it
 * indistinguishable from a traversal-rejection `422`.
 */
export class NotSyncedError extends AppError {
  constructor(message = 'Repository has not been cloned yet — wait for it to finish indexing', details?: unknown) {
    super('repo_not_synced', message, 409, details);
  }
}

export class ExternalServiceError extends AppError {
  constructor(message: string, details?: unknown) {
    super('external_service_error', message, 502, details);
  }
}

export class ConfigError extends AppError {
  constructor(message: string, details?: unknown) {
    super('config_error', message, 500, details);
  }
}
