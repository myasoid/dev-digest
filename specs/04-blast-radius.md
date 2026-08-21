# Blast Radius — the impact map for a PR

**Status:** shipped (all three phases; Graph view and the LLM summary stay out)
**Packages touched:** server, client, mcp-server
**Follows:** repo-intel T3 (persistent index, `file_rank`, `file_facts`, `file_edges`)

## Problem

A reviewer reading a diff can see what changed. They cannot see what the change
*reaches*. The question "what else could this touch?" is answered by the
relationships between symbols and files, not by the changed lines — so the diff
alone is structurally incapable of answering it.

Blast Radius answers it from the repo-intel index: symbols declared in the
changed files → who imports or calls them → which HTTP endpoints and scheduled
jobs sit downstream.

**No model is involved in the analysis.** Every node and edge comes from the
index. The map is a projection, not a generation.

## What already exists

This is most of the feature, and the reason the work below is smaller than it
looks. Stating it explicitly so nobody rebuilds it:

- **The contract.** `@devdigest/shared` `contracts/blast.ts` defines
  `BlastResult` (`changedSymbols`, `callers`, `impactedEndpoints`, `factsByFile`,
  `degraded`, `reason`) and the five-value `DegradedReason` enum. The client's
  vendored copy is byte-identical.
- **The analysis.** `RepoIntelService.getBlastRadius(repoId, changedFiles)`
  (`repo-intel/service.ts:220`) already does steps 3–4 of the original plan:
  symbols declared in changed files, cross-file resolved callers, the
  declaration file excluded (`decl_file` join), rank attached from `file_rank`,
  sorted rank DESC. Precision over recall — an unresolved (`NULL decl_file`)
  reference is never asserted as a caller.
- **The route.** `POST /repos/:id/blast` (`repo-intel/routes.ts:75`) with a real
  Zod `response` schema and a 10/min rate limit.
- **The degraded path.** `tryPersistentBlast` returns `null` when the index is
  unusable and the facade falls back to a ripgrep best-effort tagged
  `degraded: true`. `repo-intel-facade-degraded.test.ts` covers flag-off.
- **The MCP tool.** `get_blast_radius` is **already implemented and tested**
  (`mcp-server/src/tools/get-blast-radius.ts`), calls `POST /repos/:id/blast`,
  resolves an `owner/name` slug to a UUID, and reports degraded results as a
  non-error `toolMessage`. Original plan step 9 is done.
- **Clickable `file:line`.** `githubBlobUrl(repoFullName, sha, file, start, end)`
  (`client/src/lib/github-urls.ts:24`) already builds SHA-pinned blob links and
  is used by `FindingCard`. Original plan step 8 needs no new util.
- **The tab mechanism.** The PR page keys tabs off `?tab=` and renders them
  conditionally; the strip is a `tabs` array in `PrDetailHeader.tsx:116`.

## What is actually missing or wrong

Five real gaps. Three are correctness problems in code that already ships.

### 1. The per-symbol caller cap is global — silently

`service.ts:386` ends with `callers.slice(0, MAX_CALLERS_PER_SYMBOL)`. The
constant is documented as *"Caller fan-out cap per changed symbol"* and the name
says `PER_SYMBOL`, but the slice is applied to the **flat, already-merged** array
after a global `rank DESC` sort.

Consequence: a PR touching 12 symbols returns 20 callers *in total*, all of them
belonging to whichever symbols happen to live in the highest-ranked files. Every
other changed symbol renders with **zero callers and no indication that anything
was dropped** — which reads as "nothing depends on this", the most dangerous
wrong answer this feature can give.

Fix: group by `viaSymbol`, sort within the group, take 20 per group, and carry
`callerCount` + `truncated` per symbol so the UI can say *"20 of 47"*.

### 2. A `partial` index is reported as a complete answer

`tryPersistentBlast` accepts `state.status === 'partial'` and returns
`degraded: false` with no reason (`service.ts:320`, `service.ts:390`). A repo
that hit the 110 s soft budget mid-index therefore produces a map that is
indistinguishable from a complete one.

The same masking happens on staleness: the map is computed at
`repo_index_state.last_indexed_sha`, which can be many commits behind the PR's
`head_sha`. Nothing surfaces the skew today.

This is exactly what the feature must not do. `BlastResult`'s boolean
`degraded` cannot express it — it needs a three-state status.

### 3. Endpoint discovery is one level deep

Endpoints come from `file_facts` for **caller files only** — files containing a
direct reference to a changed symbol. A route handler that imports a module that
calls the changed symbol is invisible.

`file_edges` (`repository.getEdges(repoId)`) holds the import graph, so a
reverse traversal is available; blast simply does not use it. `BFS_DEPTH = 2`
exists in `constants.ts` but is consumed only by `getCriticalPaths`.

Crons have the same one-level limit, and `BlastResult` has no top-level cron
field at all — they are reachable only through the optional `factsByFile`, which
is absent on the degraded path.

### 4. Nothing is PR-scoped

There is no `GET /pulls/:id/blast`. A client must fetch the PR, map
`files[].path`, and POST them to the repo-scoped route itself — putting the
"which files changed" decision in the browser and re-deriving it per consumer.

### 5. No UI

Zero occurrences of "blast" in `client/src`. No tab, no hook, no component.

## Scope — in / out

**In**

- A PR-scoped view contract and `GET /pulls/:id/blast`.
- The three correctness fixes above (per-symbol cap, tri-state status,
  two-level reverse traversal for endpoints and crons).
- A **Blast** tab: changed symbols → callers → impacted endpoints and crons,
  with SHA-pinned `file:line` links.
- Prior PRs touching the same files.
- `get_blast_radius` gains an optional PR reference so the MCP tool and the tab
  answer from the same route.

**Out**

- **The Graph toggle** in the mockup. The Tree view carries the same
  information; a force-directed graph needs a layout dependency, and there is no
  graph-rendering library in the client today. Ship Tree, add the toggle only if
  Tree proves unreadable on a wide PR.
- **The optional LLM one-paragraph summary.** The map is already legible, the
  cost is per-PR-view rather than per-review, and a sentence generated over
  nodes the reviewer can see adds no information they do not already have. The
  route returns the facts; if a summary is wanted later it belongs in the PR
  brief, which already runs a model.
- **Recall improvements to the index itself** — unresolved references, dynamic
  dispatch, string-keyed route tables. Blast reports what the index knows and
  says so; widening what the index knows is repo-intel's own work.

  **Amended on ship.** One recall fix turned out to be a precondition rather
  than an enhancement: `extractEndpoints` matched a line at a time, so it missed
  every registration whose path sits on the line after the verb — 17 of this
  server's own 54. `file_facts` had no endpoint rows for them, so the finished
  feature returned `endpoints: []` on a real PR. That is not "the index doesn't
  know yet", it is the headline capability returning nothing while looking
  correct. Fixed with a sliding-window match and `INDEXER_VERSION` 2 → 3 (an
  incremental reindex skips unchanged files, so only a version bump rewrites the
  facts). The rest of the bullet stands.

## Contract changes

`@devdigest/shared` first, then both vendored copies via
`scripts/check-contracts.sh --fix`.

### Naming — read this before choosing an identifier

`BlastRadius` is **already taken** in `contracts/brief.ts` (a `PrBrief` summary
field, different shape, different producer), and `BlastResult` is repo-intel's
raw facade output in `contracts/blast.ts`. `contracts/blast.ts` carries a header
comment warning about the first collision. Do not add a third: the new
PR-scoped view type is `PrBlastMap`, in a new `contracts/pr-blast.ts`.

### New — `contracts/pr-blast.ts`

```ts
BlastStatus = z.enum(['ok', 'partial', 'degraded'])

PrBlastSymbol = { file, name, kind, callers: BlastCallerRow[],
                  callerCount: int, truncated: boolean }
PrBlastTarget = { label, viaFiles: string[], depth: 1 | 2 }   // endpoint or cron

PrBlastMap = {
  status: BlastStatus,
  /** Non-null whenever status !== 'ok'. Plain prose, shown verbatim in the UI. */
  explanation: string | null,
  reason: DegradedReason | null,          // reused from contracts/blast.ts
  /** SHA the index was built at — what file:line links are pinned to. */
  indexedSha: string | null,
  /** True when indexedSha !== the PR's head_sha. */
  stale: boolean,
  symbols: PrBlastSymbol[],
  symbolsTruncated: boolean,
  endpoints: PrBlastTarget[],
  crons: PrBlastTarget[],
  priorPrs: { number, title, url, sharedFiles: string[] }[],
  counts: { symbols, callers, endpoints, crons },
}
```

`BlastCallerRow` and `DegradedReason` are imported from `contracts/blast.ts` —
unchanged. `BlastResult` is unchanged; `PrBlastMap` is built on top of it.

### Status rules

| Status | When | `explanation` |
| --- | --- | --- |
| `ok` | index `full`, `indexedSha === head_sha`, no cap hit | `null` |
| `partial` | index `partial`, or stale, or any cap hit | which one, in prose — e.g. *"The index is 4 commits behind this PR's head; callers are resolved against `a1b2c3d`."* |
| `degraded` | `BlastResult.degraded === true` (flag off, no index, ripgrep path) | derived from `reason` — the flag-off wording the MCP tool already uses is the model |

Never return an empty `symbols` array to represent a missing index. An empty
array means "the index is good and nothing was found".

## Where the code goes

A new `server/src/modules/blast/`, registered in `src/modules/index.ts`.

Not in `pulls/routes.ts` — that file is already ~480 lines of inline Drizzle with
no service layer, and the grouping, traversal and status logic is real business
logic that would be stranded in the transport ring.

Per `.claude/skills/onion-architecture/references/server-module-pattern.md`:

- `routes.ts` — `GET /pulls/:id/blast`. Zod `params` + `response: PrBlastMap`,
  `getContext` for tenancy, delegates. No Drizzle.
- `service.ts` — resolves the PR and repo, gets changed files via
  `container.reviewRepo.getPrFiles(prId)`, calls
  `container.repoIntel.getBlastRadius()`, then does the grouping, the two-level
  traversal, and the status computation. Reaches other modules **only** through
  the container.
- `repository.ts` — one query only: prior PRs sharing a path (`pr_files` ⋈
  `pull_requests`, same repo, excluding this PR). Everything else is repo-intel's.

`repo-intel/service.ts` stays the sole entry point for index data — the new
module must not query `symbols`, `references`, `file_rank`, `file_facts` or
`file_edges` directly. Two repo-intel facade additions are needed:

- `getReverseImporters(repoId, files, depth)` — reverse BFS over `file_edges`,
  returning `Map<file, depth>`. Capped (see Open questions).
- `getFactsForFiles(repoId, files)` — public wrapper over the existing private
  `repo.getFileFacts`, so blast can read endpoints and crons for the traversed
  set rather than only for caller files.

## Phases

Each phase ships and reviews independently.

1. **Server.** `contracts/pr-blast.ts`, the `blast/` module, the two repo-intel
   facade additions, the per-symbol cap fix, the tri-state status, and the
   two-level traversal for endpoints and crons. No migration — every table it
   reads already exists and is already populated by the indexer.
2. **Blast tab.** `useBlastRadius(prId)` in `client/src/lib/hooks/blast.ts`
   following the `usePrReviews` pattern, a `BlastTab` component under the PR
   page's `_components/`, the entry in the `tabs` array, the tree of
   symbol → callers, endpoint and cron chips, and the status banner.
3. **Prior PRs + MCP.** The `priorPrs` section, and `get_blast_radius` gains an
   optional `pr` argument that routes to `GET /pulls/:id/blast` while keeping
   the existing `changed_files` form working.

## Acceptance criteria

1. A PR touching two symbols where one has 47 callers and the other has 3
   returns **both** symbols with callers — 20 and 3 — and the first is marked
   `truncated` with `callerCount: 47`. This fails today.
2. A repo whose `repo_index_state.status = 'partial'` returns `status: 'partial'`
   with a non-null `explanation`, not a clean-looking `ok`.
3. A PR whose `head_sha` differs from `last_indexed_sha` returns `stale: true`
   and names the indexed SHA in the explanation.
4. An unindexed repo returns HTTP 200 with `status: 'degraded'` and a populated
   `explanation` — never a 500, and never an empty `symbols` array standing in
   for "no data".
5. An endpoint in a file that imports a file that calls a changed symbol appears
   in `endpoints` with `depth: 2`. Traversal never exceeds depth 2.
6. Every `file:line` in the tab links to `githubBlobUrl(..., indexedSha, ...)` —
   the SHA the line numbers came from, **not** the PR head — and opens on the
   referencing line. Linking at `head_sha` while numbering at `indexedSha` is the
   bug this criterion exists to prevent.
7. `GET /pulls/:id/blast` and the MCP tool return the same map for the same PR.
8. The tab's header counts (`N symbols · N callers · N endpoints · N crons`)
   equal `counts`, and `counts` reflects what is **shown**, with truncation
   stated separately rather than folded into the totals.
9. Existing coverage gaps are closed for what we now depend on: `blast.it.test.ts`
   tests only changed symbols and the unindexed case — callers,
   `impactedEndpoints`, `factsByFile` and the `partial` state are untested today.
   The grouping, cap and status logic go in hermetic unit tests; the route goes
   in `*.it.test.ts`.

## Open questions

- **Reverse-traversal fan-out cap.** A hub module (a shared `utils.ts`) can have
  hundreds of importers, and depth 2 squares that. A cap is needed, but where —
  on files visited, or on endpoints returned? Visiting is the cheap part
  (`file_edges` is one indexed query); ranking and rendering are not. Provisional:
  cap visited files at 200 by `file_rank` DESC and set `status: 'partial'` when
  it binds. Revisit against a real hub-heavy PR.
- **Whether `depth: 2` endpoints deserve equal visual weight.** A direct caller's
  endpoint is a much stronger signal than one two imports away. The contract
  carries `depth` so the UI *can* distinguish; whether it should is a judgement
  to make with real data on screen.
- **Prior PRs relevance.** Matching on shared file path alone will surface
  formatting-only and lockfile PRs. Ranking by count of shared files, or
  excluding PRs above a file-count threshold, are both plausible; decide with
  seeded data rather than guessing now.
- **Recomputation cost per tab open.** The map is derived, not stored, and every
  tab open re-runs the queries. Fine at current scale; if it is not, the cache
  key is `(repoId, indexedSha, sorted changed files)` — fully determined, since
  no model is involved.
