# Insights — mcp-server

Decisions and dead ends for the standalone stdio MCP server. Read before
touching tool registration, the HTTP client, or the poller — the constraints
here are deliberate.

Read at the start of a task, written at the end of one, by the
`engineering-insights` skill. Sections are fixed — add to the one that fits,
newest first. If it would be obvious to anyone reading the code, leave it out.

Formats — `Decisions` takes prose; every other section takes a dated bullet:

```markdown
### YYYY-MM-DD — <short title>

**What:** the decision, in one sentence.
**Why:** the constraint that forced it.
**Rejected:** what we tried or considered, and how it failed.
```

```markdown
- **YYYY-MM-DD** — <the claim, specific enough to act on cold>.
  `src/path/to/file.ts:42`
```

Roughly 5 entries per section. Promote stable entries into `docs/` and delete
them here.

---

## Decisions

_None yet._

## What Works

_None yet._

## What Doesn't Work

_None yet._

## Codebase Patterns

- **2026-08-21** — `src/server.test.ts` pins each tool's description string
  verbatim with `toBe(...)`. A legitimate description change (e.g. adding a
  second form to a tool) requires updating that test to match — otherwise the
  test suite fails with a string-mismatch error that reads like a logic failure
  but is just a stale assertion. When extending a tool's description, grep
  `server.test.ts` for the old string and update it there too.
  `src/server.test.ts`

- **2026-08-21** — When a tool gains a second return shape (e.g.
  `get_blast_radius` adding the `pr` form returning `PrBlastMap` alongside the
  existing `BlastRadiusOutput`), the registered `outputSchema` must accept
  both. The pattern that works: spread `.partial()` of both Zod objects into
  the `outputSchema` shape — `{ ...ShapeA.partial().shape,
  ...ShapeB.partial().shape }`. All fields become optional, so either payload
  validates. The `content[0].text` carries the full readable output; callers
  should not rely on any specific field being non-null without checking
  `status`/`degraded` first. `src/server.ts` (`get_blast_radius`
  `outputSchema`)

## Tool & Library Notes

- **2026-08-21** — `@modelcontextprotocol/sdk`'s `McpServer.registerTool()`
  output-schema validation (`validateToolOutput` in `server/mcp.js`) skips
  validation entirely when `result.isError` is `true`, but *requires*
  `structuredContent` to be present and schema-valid whenever `isError` is
  falsy/absent — even for a "successful but incomplete" result like a
  poll-timeout. A tool whose outputSchema has required fields can't return a
  bare text message for that case; give those fields nullable/optional types
  instead so a placeholder object (e.g. `{ verdict: null, score: null,
  summary: null, findings: [] }`) still validates. `src/tools/result.ts`
  (`toolMessage`), used by `run_agent_on_pr`'s poll-timeout and
  `get_blast_radius`'s degraded/flag_off paths.
- **2026-08-21** — `registerTool()`'s `inputSchema`/`outputSchema` config
  fields take a raw Zod *shape* object (e.g. `{ repo: z.string() }`, or
  `MyZodObject.shape`), not a full `z.object(...)` instance — passing a
  `ZodObject` directly fails to typecheck against the SDK's
  `ZodRawShapeCompat` constraint. `src/server.ts`.
- **2026-08-21** — `@modelcontextprotocol/sdk@1.30.0` declares `zod` as
  `^3.25 || ^4.0`. `zod@3.24.1`, used elsewhere in this repo (e.g.
  `reviewer-core`), is outside that range — a package that depends on this
  SDK needs `zod >=3.25`. Not an issue in practice since `mcp-server` has its
  own `package.json`/lockfile and never shares a `node_modules` with the
  pnpm packages, but worth knowing before assuming any `zod` version works.

## Recurring Errors & Fixes

- **2026-08-21** — `"Could not reach the DevDigest API at http://localhost:3001.
  Start it with ./scripts/dev.sh, then retry."` does **not** mean the API is
  down. `request()` catches every `fetch` rejection in one bare `catch {}` and
  emits that single message for both `ECONNREFUSED` *and* its own
  `AbortController` abort at `timeoutMs` (15 s default), so any call slower
  than 15 s is misreported as a dead server. Hit twice in a row on
  `run_agent_on_pr` while `curl localhost:3001/health` returned `200` and port
  3001 was listening. **Both runs had completed server-side** — check
  `GET /pulls/:prId/runs` for `status: done`, which is the ground truth
  regardless of what the tool returned, then call `get_findings` to read the
  result. Do **not** re-run the review: it burns LLM credits redoing finished
  work. `src/http/client.ts:84`, `src/http/config.ts:14`

## Open Questions

_None yet._
