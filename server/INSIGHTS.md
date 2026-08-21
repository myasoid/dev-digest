# Insights — server

Server-side decisions and dead ends. Read before redesigning anything here; a
lot of what looks arbitrary was a deliberate trade-off.

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
them here. Insights about `src/vendor/shared/` go in the **root** `INSIGHTS.md` —
a contract change reaches every package.

---

## Decisions

### 2026-08-18 — `pr_intent` carries `head_sha`, not just confidence/signals/risk_areas

**What:** the Intent Layer's `pr_intent` table got a fourth new column,
`head_sha` (the PR's head SHA at classification time), beyond the three the
feature plan's DB step named (`confidence`, `signals_used`, `risk_areas`).
**Why:** the same plan's client requirement — a staleness indicator "when the
PR's headSha has changed since the cached intent was computed" — has no way to
be computed without a snapshot of the SHA the classification ran against;
`pull_requests.head_sha` alone only gives the CURRENT head, not what the cached
intent was classified against.
**Rejected:** leaving staleness unimplemented as an out-of-scope UI nicety —
the plan listed it as a required panel element, not optional, so dropping it
would be reading the plan more narrowly than it reads itself.
`server/src/db/schema/reviews.ts` (`prIntent.headSha`),
`server/src/vendor/shared/contracts/brief.ts` (`Intent.head_sha`)

### 2026-07-31 — Schema-first validation at the route boundary

**What:** every route declares Zod `params`/`body`/response schemas from
`@devdigest/shared` via `fastify-type-provider-zod`; invalid input is rejected
with `422` before the handler runs.
**Why:** one definition has to drive both request validation and response
serialization, or the two drift.
**Rejected:** hand-rolled `Schema.parse(req.body)` inside each handler — it
validated input only, left responses unchecked, and duplicated the schema
reference in every route.

### 2026-08-14 — Conventions evidence is re-derived from disk, never trusted from the model

**What:** `ConventionsService.extract`'s evidence gate
(`modules/conventions/extract.ts`, `verifyEvidence`) checks only that
`evidence_path` exists in the clone and `evidence_start_line..evidence_end_line`
is in-bounds — then OVERWRITES `evidence_snippet` with the real on-disk lines
before anything is persisted. The model's own snippet text is never stored.
**Why:** citing a real line range is a much weaker claim than quoting it
correctly, and a persisted quote a user might use to justify accepting a
convention has to be trustworthy by construction, not by hoping the model
transcribed it faithfully.
**Rejected:** fuzzy-matching the model's `evidence_snippet` against the real
source at that location and dropping candidates below a similarity threshold.
Works, but adds a threshold to tune and still ships the model's wording on a
match — verify-then-replace gives a stronger guarantee for less code.
`server/src/modules/conventions/extract.ts` (`verifyEvidence`)

## What Works

_None yet._

## What Doesn't Work

_None yet._

## Codebase Patterns

- **2026-08-21** — `getBlastRadius`'s caller cap is named and documented
  per-symbol (`MAX_CALLERS_PER_SYMBOL = 20`, *"Caller fan-out cap per changed
  symbol"*, `repo-intel/constants.ts`) but applied **globally**:
  `tryPersistentBlast` merges every changed symbol's callers into one array,
  sorts it `rank DESC` across all symbols, then ends with
  `callers.slice(0, MAX_CALLERS_PER_SYMBOL)`. A PR touching 12 symbols gets 20
  callers *in total*, all belonging to whichever symbols sit in the
  highest-ranked files; every other changed symbol returns an empty caller list
  with no truncation flag — indistinguishable from "nothing depends on this",
  which is the most dangerous wrong answer the feature can give. The general
  shape to watch for here: a per-group limit applied *after* the groups are
  flattened silently starves the low-ranked groups. Cap per group, and return
  the pre-cap count so the consumer can render "20 of 47".
  `server/src/modules/repo-intel/service.ts:386`, `specs/04-blast-radius.md`
  **Fixed 2026-08-21 in `server/src/modules/repo-intel/service.ts`**: now
  groups callers by `viaSymbol`, sorts within each group, and pushes
  `group.slice(0, MAX_CALLERS_PER_SYMBOL)` — one cap per symbol, not global.

- **2026-08-21** — repo-intel's degraded contract (`degraded?: boolean` +
  `reason`, per the DEGRADED CONTRACT header in `repo-intel/types.ts`) cannot
  express a third state, and a third state exists. `tryGetIndexState` marks a
  row degraded only when `status === 'degraded' || status === 'failed'`
  (`repository.ts:218`), while `tryPersistentBlast` explicitly *accepts*
  `status === 'partial'` (`service.ts:320`) and returns `degraded: false` with
  no `reason`. So a repo that hit the 110 s `INDEX_SOFT_BUDGET_MS` mid-index
  answers facade reads as though it were fully indexed. The same masking
  applies to staleness — results are computed at
  `repo_index_state.last_indexed_sha` and nothing surfaces the skew from the
  caller's SHA. A consumer that must not present incomplete data as complete
  has to call `getIndexState()` itself and derive its own tri-state; the
  boolean will not tell it. `server/src/modules/repo-intel/service.ts:320`,
  `server/src/modules/repo-intel/repository.ts:218`
  **Resolved 2026-08-21** via `PrBlastMap` and `blast/service.ts`:
  `BlastService.getBlastMap` calls `getIndexState()` itself, checks `status
  === 'partial'` and `indexedSha !== pr.headSha` independently, and derives
  `BlastStatus` ('ok'/'partial'/'degraded') as a pure function `deriveStatus`
  — the boolean `BlastResult.degraded` is only the gate for the fully-degraded
  path. `server/src/modules/blast/service.ts`

- **2026-08-21** — `PrBlastSymbol.callerCount` and `truncated` are now exact:
  `BlastResult` carries an optional `callerCounts: Record<viaSymbol, number>`
  populated by `tryPersistentBlast` **before** the per-group
  `slice(0, MAX_CALLERS_PER_SYMBOL)`. `buildSymbols` reads that field for the
  true pre-cap total and sets `truncated = total > callers.length` (exact, not
  a `>= cap` guess). When `callerCounts` is absent (ripgrep/degraded path, no
  cap applies) `truncated` is always `false`. The old `>= MAX_CALLERS_PER_SYMBOL`
  heuristic produced two wrong answers: "47 capped to 20" was correct but "exactly
  20" was a false positive. Threading the pre-cap counts is the minimal change —
  no re-query needed. `server/src/vendor/shared/contracts/blast.ts`
  (`callerCounts` field), `server/src/modules/repo-intel/service.ts`
  (`tryPersistentBlast`), `server/src/modules/blast/service.ts` (`buildSymbols`)

- **2026-08-21** — `@devdigest/shared`'s barrel (`index.ts`) does `export *`
  from every `contracts/*.ts` file with no collision check beyond what `tsc`
  catches (a literal duplicate *name* fails to compile). A near-miss —
  different name, same domain concept — compiles clean and is a pure
  human-review risk: `contracts/brief.ts` already exports `BlastRadius` (a
  `PrBrief` summary field: `changed_symbols`/`downstream`/`summary`, produced
  by the PR-brief classifier), and the new `contracts/blast.ts` needed to add
  an unrelated `BlastResult` (repo-intel's `getBlastRadius()` facade return
  type). Before naming a new contract, grep the barrel's existing exports for
  near-synonyms of the concept, not just an exact-name collision — `tsc` will
  not warn you either way. `server/src/vendor/shared/contracts/blast.ts`,
  `server/src/vendor/shared/contracts/brief.ts:74`

- **2026-08-19** — a classifier driven by a hand-written glob-pattern list
  (`WIRING_PATTERNS`/`BOILERPLATE_PATTERNS` in
  `server/src/modules/reviews/smart-diff/constants.ts`) reads as complete —
  every pattern is documented and its own unit tests pass — while still
  missing a whole naming *convention*, not just one path. `*.config.*` covers
  `vite.config.ts`-style names but not the equally common bare `config.ts`
  (e.g. `src/config.ts`), so that file classified as `core` instead of
  `wiring` until caught by rendering the feature against seeded PR #482 and
  diffing the result against the feature's design-reference screenshot.
  Hermetic tests didn't catch it because the missing case was never written
  as a test — the classifier's own test suite can only be as complete as the
  author's imagination of file-naming conventions. Fixed by adding a
  `config.*` pattern to `WIRING_PATTERNS`, plus a negative test
  (`configurationLoader.ts` must stay `core`) so the fix doesn't regress into
  a naive substring match. When adding a new pattern-list classifier, verify
  it against a real rendered example before trusting the pattern list is
  exhaustive — self-authored unit tests will not surface a convention the
  author didn't think of. `server/src/modules/reviews/smart-diff/constants.ts`,
  `server/src/modules/reviews/smart-diff/classifier.test.ts`
  **Second instance, 2026-08-21 — same failure mode, different subsystem, so
  treat this as the general rule for every regex/pattern extractor here.**
  `extractEndpoints` (`src/adapters/codeindex/extract.ts`) matched `app.post(…)`
  one line at a time, and its fixtures only ever used the single-line form. But
  wherever a route carries an options object this repo wraps it, putting the
  path on the *next* line (`app.post(\n  '/repos/:id/blast',`) — 17 of the
  server's own 54 registrations. Those endpoints were therefore never written to
  `file_facts`, and blast radius reported `impactedEndpoints: []`, which reads
  as "this diff reaches no endpoints" rather than "the extractor cannot see
  them" — a silent wrong answer, not a visible gap. Fixed by matching over a
  sliding 2-line window (8 for the `{ method, url }` object form) plus a
  negative test that an unrelated nearby string is not glued onto a bare
  `app.listen(`. After the fix one changed file surfaced 49 endpoints where it
  had surfaced 0. Note the second-order trap: changing the extractor does
  nothing to existing indexes on its own, because an incremental reindex skips
  unchanged files — `INDEXER_VERSION` must be bumped to force the rebuild.
  `server/src/adapters/codeindex/extract.ts`, `server/test/extract.test.ts`

- **2026-08-14** — a grouped-by-`X` aggregate query (`GROUP BY skill_id`, one
  round trip for the whole list) and a single-item version of the same
  aggregate (one skill's stats) don't need two query implementations. Give the
  method an OPTIONAL `id?: string` and push it into the `WHERE` as one more
  condition (via a plain `conditions: SQLWrapper[]` array, not `and(...,
  maybe-undefined)` — TypeScript's overload resolution on `and()` gets
  ambiguous with a conditionally-undefined argument): with the filter, the
  `GROUP BY` result collapses to at most one row; without it, you get the map
  for every skill in the workspace. `SkillsRepository.usedByCounts` /
  `.runsWithSkillCounts` / `.runsTotalCounts` / `.findingsCounts` are all this
  shape, called once with no `skillId` for `GET /skills`'s list footer and once
  WITH `skillId` for `GET /skills/:id/stats` — no query is written twice.
  `server/src/modules/skills/repository.ts`

- **2026-08-14** — every package sets `noUncheckedIndexedAccess: true`, so the
  `const [row] = await db.insert(...).returning()` idiom types `row` as
  `Row | undefined` and used to be closed with `row!` in five places
  (`modules/agents/repository.ts`, `modules/repos/repository.ts`,
  `modules/reviews/repository/review.repo.ts`,
  `modules/reviews/repository/run.repo.ts`, `platform/jobs.ts`). `!` is banned
  (`@typescript-eslint/no-non-null-assertion`, `eslint.config.js`); the settled
  shape is `if (!row) throw new Error('insert into <table> returned no row')`,
  a plain `Error` (→ 500) and **not** `NotFoundError`, because a single-row
  `INSERT ... RETURNING` yielding nothing is a broken invariant, not a missing
  resource. Copy that line when adding a new repo insert.
  `server/src/modules/repos/repository.ts:55`

- **2026-08-04** — `agent_runs` counters (`findings_count`, `blockers`, and now
  `critical_count`/`warning_count`/`suggestion_count`) are denormalized onto the
  run row once, at run completion in `run-executor.ts`, and never recomputed —
  even after a finding is later accepted/dismissed. This is intentional: the
  timeline shows the deterministic CI-gate snapshot, not a live view. A new
  per-severity/per-status counter on a run belongs in this same
  compute-once-at-write-time path (new column + migration), not a read-time
  `JOIN`/`GROUP BY` over `findings` — the latter would silently diverge from
  `blockers`' semantics (gate-tripped at run time vs. currently-live findings).
  `server/src/modules/reviews/run-executor.ts:238` (blockers/counts computed),
  `server/src/modules/reviews/repository/run.repo.ts:40` (read path, no
  aggregation query).
  **Qualified 2026-08-07:** that rule is about *per-run* counters. The PR
  **list**'s FINDINGS column deliberately does the opposite — a read-time
  aggregation over `findings` filtered by `isNull(dismissedAt)`, scoped to the
  latest `reviews` row. Three reasons the snapshot could not be reused: it is
  frozen at completion so it still counts dismissed findings; `agent_runs` has
  no FK to `reviews` (see `contracts/trace.ts`) so it cannot be scoped to the
  latest review at all; and the list embeds the finding rows for a hover popup,
  so a badge sourced from the snapshot would read "3" above a 2-row popup.
  Consequence to expect, not to "fix": after a dismissal the list's counts and
  the run timeline's counts legitimately disagree — live view vs. CI-gate
  snapshot. `server/src/modules/pulls/routes.ts` (findings block),
  `server/test/pulls-findings.it.test.ts`.

- **2026-08-04** — `ReviewRepository` in `repository.ts` re-declares each repo
  function's params type inline instead of importing it from the
  `repository/*.repo.ts` module that owns it (e.g. `completeAgentRun`'s
  `values` shape is written out twice: `repository.ts:153` and
  `repository/run.repo.ts:148`). Adding a field to one and not the other
  type-errors immediately at the call site, but only because both call sites
  happen to be typechecked in the same `tsc` run — it is easy to touch only one
  copy and get a real but confusing error pointing at the *caller*, not the
  missing field.

- **2026-08-07** — the `routes.ts → service.ts → repository.ts` layering is a
  convention, not something enforced: 4 of 8 feature modules —
  `modules/pulls/routes.ts`, `modules/polling/routes.ts`,
  `modules/settings/routes.ts`, `modules/workspace/routes.ts` — have no
  `service.ts`/`repository.ts` at all and query Drizzle + hold business logic
  directly in the route handler. The `dependency-cruiser` dep in `package.json`
  is not a self-lint — it only analyzes *other people's* cloned repos for the
  product feature. Treat those four as a documented exception (see
  `.claude/skills/onion-architecture/SKILL.md`), not something to fix as a
  drive-by — but apply the full split to any new module.
  **Enforced 2026-08-14:** `no-restricted-imports` in `server/eslint.config.js`
  now bans `drizzle-orm` and `db/schema` from every `src/modules/*/routes.ts`
  and `service.ts`, and `pnpm lint` gates it in `server-unit.yml`. The four
  legacy modules are exempted by an explicit `files:` list in that config
  rather than by loosening the rule, so the exception stays countable — that
  array should only ever get shorter. The other four modules were already
  clean when the gate went in; this codified reality, it did not force a
  refactor. `server/eslint.config.js`

## Tool & Library Notes

- **2026-08-21** — Drizzle's `inArray(column, array)` is the correct way to
  emit `WHERE column = ANY($1)` with proper parameter binding. Writing a raw
  `sql\`${col} = ANY($1::text[])\`` inline is wrong — Drizzle's parameter
  counter does not know about the `$1` inside the template literal, so the
  generated query either binds the wrong slot or fails with a missing-parameter
  error. `inArray` handles the binding automatically and is what repositories
  should reach for whenever filtering by membership in a caller-supplied
  array. `server/src/modules/blast/repository.ts`

- **2026-08-19** — a `/** ... */` JSDoc block comment that quotes a glob
  pattern ending in `**` immediately followed by a literal `/` (e.g. writing
  `` `dist/**` `` in prose) closes the comment early: esbuild sees the `*/`
  inside the text and stops parsing there, then chokes on the next word as
  invalid syntax (`Expected ";" but found "dist"`). Vitest's `vite:esbuild`
  transform surfaces this as a failed-to-transform error on the whole file, not
  a comment warning. Fix: don't write the trailing `**` directly against a
  `/` in a doc comment — say "a nested `dist` directory" instead of
  `` `dist/**` ``, or escape it like `` `**\/dist/**` `` if the literal glob
  must appear. `server/src/modules/reviews/smart-diff/constants.ts`

- **2026-08-14** — capping an uploaded archive's size does **not** cap what it
  decompresses to, and with `fflate` the only place to stop a bomb is the
  per-entry `filter`. `unzipSync` allocates each entry's output buffer from the
  archive's self-declared `originalSize` *before* inflating a byte, so a check on
  the extracted string runs far too late. Measured on the pinned `fflate@0.8.3`:
  a 1,047,928-byte zip — half our 2MiB upload budget — inflated to 1GiB, drove
  RSS to 2,122MB and blocked the event loop for 4.6s, and because `unzipSync` is
  synchronous that stalls the whole API. Deflate reaches ~1024:1, so budget for
  ~1000× the upload cap. The filter receives `size`/`originalSize`, so reject
  there on both the single entry and a running total, and re-check the real
  `bytes.length` afterwards because the header is the author's claim. Two traps
  in the fix: the surrounding `try/catch` will swallow a `ValidationError` thrown
  from the filter into a generic "is it a valid .zip?" unless you rethrow it, and
  past ~512MB the failure surfaces as `RangeError: Cannot create a string longer
  than 0x1fffffe8 characters` from `TextDecoder`, which a bare catch reports as
  "not valid UTF-8". `server/src/modules/skills/import.ts:131`,
  `server/test/skills-import.test.ts` ("refuses a zip bomb WITHOUT inflating it")

## Recurring Errors & Fixes

- **2026-08-21** — `export type { X } from 'module'` (a re-export) does NOT
  bind `X` into the *local* module's scope for further use in that same
  file — it only makes `X` importable from elsewhere. Promoting
  `BlastResult`/`BlastChangedSymbol`/`BlastCallerRow`/`DegradedReason` from
  plain interfaces in `repo-intel/types.ts` to inferred types re-exported
  from `@devdigest/shared` broke immediately: `RepoIntel.getBlastRadius():
  Promise<BlastResult>` in that same file needs `BlastResult` as a locally
  usable type, and a bare `export type {...} from '@devdigest/shared'` does
  not provide that. Fix: `import type { BlastResult, ... } from
  '@devdigest/shared'` first, then a separate `export type { BlastResult,
  ... };` (no `from`) to both use it locally and keep re-exporting it.
  `server/src/modules/repo-intel/types.ts`

- **2026-08-19** — "zero consumers" for a contract field (the bar for treating
  a shape change as non-breaking, no deprecation path needed) must be checked
  against `server/test/contracts.test.ts` too, not just application code —
  that file's fixture tests `.parse()` a hand-written literal against every
  exported contract, so a field rename/reshape there (e.g.
  `SmartDiffFile.finding_lines` → `SmartDiffFile.findings`) makes a previously
  "unconsumed" contract fail a `ZodError: Required` on the OLD fixture the
  moment the schema changes, even though no real caller broke.
  `server/test/contracts.test.ts`

- **2026-08-14** — a repository *update* that returns `Row | undefined` is
  signalling a real read-modify-write race, not type noise, and asserting it
  away turns a 404 into a 500. `actOnFinding` checked existence via
  `repo.findingContext(findingId)` and then wrote
  `findingRowToDto(row!)` on the result of `setFindingAccepted` /
  `setFindingDismissed` — if the finding was deleted in that gap the `UPDATE`
  matched zero rows and the route 500'd on `Cannot read properties of
  undefined`. Fix is `if (!row) throw new NotFoundError('Finding not found')`;
  `app.ts`'s error handler maps any `AppError.statusCode` straight through, so
  that is the only thing needed for a 404. Assume the same gap in any
  `lookup-then-update` pair here. `server/src/modules/reviews/findings.ts:25`

## Open Questions

_None yet._
