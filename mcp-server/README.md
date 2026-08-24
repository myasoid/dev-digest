# mcp-server (`@devdigest/mcp-server`)

A standalone, local-only [MCP](https://modelcontextprotocol.io) server exposing
5 tools over **stdio transport**, backed by the already-running DevDigest
Fastify API (`http://localhost:3001`) as a black-box JSON HTTP client. It has
no direct dependency on `server/src` or the database — every tool is a thin
wrapper over an HTTP call, hermetically testable by mocking `fetch`.

> **Naming note:** the package is deliberately called `mcp-server`, not
> `devdigest-mcp` — the name used in the root `README.md`'s L04 roadmap line.
> This is a chosen deviation, not an oversight; see
> `mcp-server/specs/development-plan.md`.

## Why it doesn't import `@devdigest/shared`

Every other package vendors `@devdigest/shared` and stays in sync via
`./scripts/check-contracts.sh`. That script only covers `server` ↔ `client`.
`vendor/shared` also has no `package.json` of its own, so a third vendored
copy here would have no sync mechanism and would drift silently. Instead,
`src/schemas.ts` defines independent Zod schemas that mirror the JSON shapes
the API actually returns — annotated with the same field semantics, kept
manually in sync by reading the server's routes/contracts when they change.

## Tools

| Tool | Wraps | Notes |
|---|---|---|
| `list_agents` | `GET /agents` | Call first to get valid `agent` ids/names. |
| `run_agent_on_pr` | `POST /pulls/:id/review` → poll `GET /pulls/:id/runs` → `GET /pulls/:id/reviews` | One call: start + wait (up to 3 minutes) + fetch. |
| `get_findings` | `GET /pulls/:id/reviews` | Latest completed review only — no `run_id` parameter. |
| `get_conventions` | `GET /repos/:id/conventions` | Read-only; never triggers extraction. |
| `get_blast_radius` | `POST /repos/:id/blast` | May return a degraded (not an error) result until the repo is indexed. |

## Run the stack

From the repo root:

```sh
./scripts/dev.sh
```

This brings up Postgres, the API (`:3001`, seeded with a demo repo
`acme/payments-api`, PR #482, and 5 reviewer agents), and the Next.js studio.
The MCP server only needs the API — `--no-client` also works.

## Run this MCP server

```sh
cd mcp-server
npm install
cp .env.example .env   # DEVDIGEST_API_URL defaults to http://localhost:3001 anyway
npm run dev             # tsx watch, for local iteration
# or, for a built/production-style run:
npm run build && npm start
```

Because the transport is stdio, running it directly in a terminal just waits
for a JSON-RPC-speaking client on stdin — that's expected, not a hang.

## Wiring it into Claude Code / Claude Desktop

Add an entry to the client's MCP server config (`claude_desktop_config.json`
for Desktop, or the equivalent Claude Code MCP config) pointing at the built
entrypoint:

```json
{
  "mcpServers": {
    "devdigest": {
      "command": "node",
      "args": ["/absolute/path/to/dev-digest/mcp-server/dist/index.js"],
      "env": {
        "DEVDIGEST_API_URL": "http://localhost:3001"
      }
    }
  }
}
```

Run `npm run build` first so `dist/index.js` exists. Restart the client after
editing its config.

## Inspecting it manually

[MCP Inspector](https://github.com/modelcontextprotocol/inspector) drives the
server over stdio without needing a full client:

```sh
cd mcp-server
npx @modelcontextprotocol/inspector npm run start
```

(Run `npm run build` first, since `start` runs the built `dist/index.js`.)
Open the printed local URL, then exercise each tool from the Inspector UI.

## Manual per-tool verification (against seed data)

With `./scripts/dev.sh` running and the demo seed loaded (`acme/payments-api`,
PR #482, 5 agents: General/Security/Performance/Test Quality/API Contract
Reviewer):

1. `list_agents` — expect 5 agents back, all `enabled: true`.
2. `run_agent_on_pr({ repo: "acme/payments-api", pr: 482, agent: "Security Reviewer" })`
   — expect it to block for the run's duration, then return a verdict +
   findings (or the poll-timeout message if it's still running after 3
   minutes — call `get_findings` shortly after to fetch it).
3. `get_findings({ repo: "acme/payments-api", pr: 482 })` — expect the same
   result as the most recent `run_agent_on_pr` call above, without starting
   a new run.
4. `get_conventions({ repo: "acme/payments-api" })` — expect either an empty
   `candidates` array (never scanned) or previously-accepted candidates; this
   tool never triggers a scan itself.
5. `get_blast_radius({ repo: "acme/payments-api", changed_files: ["src/index.ts"] })`
   — on a freshly-seeded, not-yet-indexed repo expect `degraded: true` with
   `reason: "no_data"` and the corresponding non-error message. Trigger
   indexing with `POST /repos/:id/resync` against the API directly, wait for
   it to finish, then retry to see a real (non-degraded) impact map.

Also verify the forward-leading error paths: an unknown `repo` slug, an
unknown `pr` number, and an unknown `agent` ref should each return
`isError: true` with a message naming the next tool/action to call (see
`mcp-server/specs/development-plan.md`, "Error-message design") — never a
bare error code.

## Testing

All tests are hermetic — `fetch` is mocked, there is no real network or DB.

```sh
npm test        # vitest
npm run typecheck
```

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `DEVDIGEST_API_URL` | `http://localhost:3001` | Base URL of the running DevDigest API. |
| `DEVDIGEST_API_TIMEOUT_MS` | `15000` | Per-request timeout before treating the API as unreachable. |

No auth headers are sent — the DevDigest server has no auth middleware in
local dev (`LocalNoAuthProvider` always resolves the single seeded
workspace). This server is local-only; it is not designed for a remote
transport or a multi-tenant deployment.
