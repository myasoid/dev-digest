# server/docs/api-contracts.md

Conventions for adding or changing an API route and its Zod contract — the
*shape* every endpoint follows. Not the route map (that's `../README.md`'s
"API map") and not module internals (each module's own README, e.g.
`src/modules/repo-intel/README.md`).

## Contract-first

- Every request/response shape is a Zod schema in `@devdigest/shared`
  (`src/vendor/shared/contracts/`) — never inlined in a `routes.ts`.
- Change the schema in `@devdigest/shared` **first**, then update consumers
  (server routes, client hooks). No route-local ad hoc types.
- Persisted/transport shapes **extend** the core domain schema instead of
  redefining it, e.g. `FindingRecord = Finding.extend({ review_id, accepted_at,
  dismissed_at })` in `contracts/review-api.ts`. Follow the same pattern for a
  new persisted shape.

## Wiring a route

- Pass `schema: { params, body, response }` to
  `app.withTypeProvider<ZodTypeProvider>()` — one Zod definition drives
  **both** request validation and response serialization
  (`fastify-type-provider-zod`).
- Invalid input → `422`, automatically, before the handler runs. Don't
  hand-roll `Schema.parse(req.body)` for something already declared in
  `schema.body`. The one accepted exception is a genuinely all-optional body
  where an empty object must be valid (`RunRequest.parse(req.body ?? {})` on
  `POST /pulls/:id/review`) — there `schema.body` is omitted on purpose.
- `:id` params: reuse the shared `IdParams` (`_shared/schemas.ts`), which
  validates a uuid. Not every `:id` is a uuid — e.g. `/providers/:id` addresses
  a provider name — those routes declare their own params schema instead of
  reusing `IdParams`.
- Errors are `AppError` subclasses (`platform/errors.ts`); the shared error
  handler turns them into a structured envelope `{ error: { code, message,
  details } }` with the subclass's status code (`NotFoundError` → 404,
  `ValidationError` → 422, `ExternalServiceError` → 502, `ConfigError` → 500).
  Throw the narrowest subclass — don't return a raw error object from a
  handler.
- Rate limiting: a global 120/min covers every route by default (disabled
  under `NODE_ENV=test`). Add a tighter per-route
  `config: { rateLimit: { max, timeWindow } }` on anything that can fan out to
  an LLM call or other expensive work (`POST /pulls/:id/review` caps at
  10/min). SSE endpoints and `/health*` opt out with
  `config: { rateLimit: false }`.
- Modules are registered statically, one plugin per `modules/<name>/routes.ts`
  in `src/modules/index.ts`. A new endpoint on an existing resource goes in
  that module's existing `routes.ts`; a genuinely new resource gets its own
  module.

## Checklist for a new endpoint

1. Add or extend the Zod contract in `@devdigest/shared`
   (`server/src/vendor/shared/contracts/`).
2. Add the route in the owning module's `routes.ts` with
   `schema: { params, body, response }`.
3. Implement the behavior in that module's `service.ts` — never inline
   DB/adapter calls in the route handler.
4. Add a hermetic unit test, plus a `*.it.test.ts` if the endpoint is
   DB-backed.

## Not here

- The route map — that's `../README.md` ("API map").
- Endpoints that don't exist yet — that's `../specs/`.
- Why a contract shape was rejected or reworked — that's `../INSIGHTS.md`.
