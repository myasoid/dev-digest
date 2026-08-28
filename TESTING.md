# Testing & CI strategy

DevDigest is five independent packages (no workspace), so testing is organised
as **one suite per package**, each with its own CI workflow, runner, and path
filter. A package's suite runs only when that package (or a package it depends
on at type-check time) changes.

## Philosophy — typological, not exhaustive

We do **not** chase line coverage. Each suite covers the *kinds* of things that
can break in that layer — one happy path plus the edge that actually matters per
workflow — and deliberately skips the rest. Concretely:

- **Test behaviour at the seams**, not implementation details. Routes, adapters,
  contracts, the review pipeline, the rendered component.
- **Mock the outside world.** LLMs, GitHub, and git are stubbed via
  `server/src/adapters/mocks.ts` so unit tests are hermetic and key-free.
- **One real integration per data-backed workflow**, against a real Postgres —
  not a mock DB — because the bugs there live in SQL, migrations, and wiring.
- **A few end-to-end browser flows** over the *main* user journeys, on seeded
  data, with no LLM in the loop.

If a test wouldn't catch a class of regression we care about, we don't write it.

## Suite map

| Suite | Package | Kind | Runner | Workflow | Docker? |
|-------|---------|------|--------|----------|---------|
| client | `client/` | component / unit (jsdom) | vitest | `client.yml` | no |
| server-unit | `server/` | unit (hermetic) | vitest | `server-unit.yml` | no |
| server-integration | `server/` | integration (real Postgres) | vitest | `server-integration.yml` | **yes** |
| reviewer-core | `reviewer-core/` | unit (engine) | vitest | `reviewer-core.yml` | no |
| mcp-server | `mcp-server/` | unit (stdio tools, stubbed HTTP) | vitest | `mcp-server.yml` | no |
| e2e web | `e2e/` | browser e2e (deterministic) | agent-browser + `run.ts` | `e2e-web.yml` | yes (stack) |

## What each suite covers

**client** — components render and react to interaction (React Testing Library
+ jsdom). `fetch` is mocked; no API, DB, or browser. Covers the PR-review
surface (list, diff, findings, run controls), the agent editor, and the skills
surface. For the Skills tab the ordering logic is tested as pure functions
(`SkillsTab/helpers.ts`) rather than through the drag, which jsdom cannot
meaningfully drive — the drag wiring is a thin, untested shell over them.

**server-unit** — the DB-free majority: adapters, prompt assembly, grounding,
repo-intel ranking & indexing, pricing, route smoke. The `typecheck` job also
runs on Windows, which doubles as the `@ast-grep/napi` prebuilt gate (install
fails there if the win32 prebuilt is missing).

**server-integration** — the `*.it.test.ts` files. Each starts a real Postgres
(pgvector) via testcontainers, builds the Fastify app, migrates + seeds, and
drives routes end-to-end: reviews + run lifecycle (incl. grounding), agents CRUD,
skills CRUD + versioning + reuse across agents, skills reaching the assembled
prompt, repo-intel symbol clamping, pulls comments, settings models. They
self-skip when Docker is unavailable.

> A run's status goes terminal BEFORE its trace document is written — they are
> two statements in `run-executor.ts`. A test that asserts on a trace must poll
> `run_traces`, not just `waitForPrRuns`; waiting on the status alone passes on
> an idle machine and fails when the suite runs in parallel.

**reviewer-core** — the pure engine: `toReview` selection, prompt construction,
and a `run` with a stubbed model → grounded findings. No DB / GitHub / FS.

**mcp-server** — the five stdio tools plus the HTTP client they sit on. Hermetic
by construction: `ApiClient` tests stub `fetch` via `vi.stubGlobal`, and each
tool test injects a hand-rolled fake `ApiClient` that answers by path prefix. No
DevDigest API, no network, no Docker. Covers tool argument resolution
(`resolve.test.ts`), run polling (`run-poller.test.ts`), server wiring
(`server.test.ts`), and one file per tool under `src/tools/`.

**e2e web** — see `e2e/README.md`. Deterministic agent-browser flows over the
main journeys (boot → PR list → PR detail; agents; skills) against a real seeded
stack. No `chat`, no model key.

**Not a suite: `cd server && pnpm experiment:skills`.** Runs each skills-enabled
agent over a fixed diff with and without its skills against a REAL model, and
prints both reviews. It costs money, is stochastic, and is not in CI — it answers
"does this skill change the review", which is a question no assertion can settle.
Default 5 runs per condition, because a single pair of samples is noise.

## Running locally

```sh
# per package
cd client        && pnpm test           # + pnpm typecheck
cd reviewer-core && npm test
cd mcp-server    && npm test

# server — the unit/integration split (see note below)
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'   # unit, no Docker
cd server && pnpm exec vitest run .it.test                      # integration, needs Docker
cd server && pnpm test                                          # both — starts Docker

# browser e2e (needs the full stack + agent-browser CLI)
./scripts/dev.sh
npm i -g agent-browser && agent-browser install
cd e2e && npm install && npm test
```

## Conventions

- **Don't bother switching reporters to save agent context.** Measured on
  `mcp-server` (9 files, 48 tests) under vitest 2.1.9 in a non-TTY shell,
  `default`, `dot` and `basic` all produce the same ~20 lines — one line per
  file plus the summary — with or without `CI=1`. The reporter is not where a
  test run's output cost lives; a booted testcontainer is (see below). Use
  `--silent` if a suite's own `console.log` is noisy.
- **`vitest related` is the inner loop.** While iterating on a change, run only
  the tests that reach the files you touched:
  `pnpm exec vitest related --run src/foo.ts src/bar.ts`. Run the package's full
  suite **once**, at the end — not after every edit.
- **Never run `pnpm test` in `server/` to check a code change.** That script is
  `vitest run` with no exclude, so it pulls in `*.it.test.ts`, boots
  testcontainers Postgres, and runs with a 120s timeout per test. The hermetic
  command is `pnpm exec vitest run --exclude '**/*.it.test.ts'`.
- **Integration tests end in `*.it.test.ts`.** The unit lane excludes that glob
  (`vitest run --exclude '**/*.it.test.ts'`); the integration lane selects only
  it (`vitest run .it.test`). A DB-backed test that imports `test/helpers/pg.ts`
  must use the `.it.test.ts` suffix.
- **`server/package.json` is `skip-worktree`** (a local variant diverges from the
  committed file). CI therefore invokes the split with
  `pnpm exec vitest run …` rather than relying on committed `test:unit` /
  `test:integration` scripts.
- **Hermetic by default.** Reach for `src/adapters/mocks.ts` (MockLLMProvider,
  MockGitClient) rather than real network/keys.
- **E2E specs are deterministic batch JSON** (`e2e/specs/*.flow.json`) using
  only `--url` / `--text` / `find` locators — never the AI `chat` command.
- **CI is path-filtered per package.** Cross-package source aliases are encoded
  in each workflow's `paths:` (e.g. `reviewer-core/**` triggers `server-unit`
  because the server type-checks against `../reviewer-core/src`).
- **`server/clones/**` is runtime data** (git-ignored) and never collected by
  any suite.
