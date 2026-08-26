# Project Context — Discovery-scope Amendment Plan (SPEC-cross-05, amendment 2026-08-26)

Status: ready for implementation. A **follow-up delta plan** for the single
amendment to an already-shipped feature. Derived from
`specs/2026-08-25-project-context.md` (the "Amendment (2026-08-26)" note and the
sections it lists), which is the authority — if this plan and the spec disagree
on *what*, the spec wins; on *how*, this file wins. The base build is described
by `specs/2026-08-25-project-context-plan.md` (19 Steps, 5 phases), whose Steps
5, 6, 8 and 10 built the surfaces this amendment edits.

## Why a new file, not an in-place edit of the original plan

The original plan is a finished, executed artifact: an `implementer` ran all 19
Steps, `plan-verifier` marked all 46 ACs "Met", `architecture-reviewer` came
back clean, and a `test-writer` pass followed — all on top of baseline
`06dd55b`, currently uncommitted in the working tree. Editing that file in place
would do two harmful things. First, it would erase the record that the original
plan was *executed as written* — a future reader trusts an executed plan
differently from a draft, and silently rewriting Steps 5/6/8 to describe the
amended behaviour would make the executed history unreadable. Second, the delta
is narrow (discovery only: eight ACs touched out of 46) but its trickiest parts
— a path-identity backward-compat trap and a new set-level contract field —
have nothing to anchor to in the original plan's per-step prose. A focused file
that states *only what changes, against the code as it now exists in the working
tree* is cheaper for the next session to trust than a 19-step plan with six
Steps quietly mutated. This file therefore **supersedes Steps 5, 6 and 8 of the
original plan for the discovery axis only**, and is explicit about what it does
*not* touch. The original plan file stays as the record of the base build.

## Objective

Widen document **discovery** from the three fixed `.devdigest/{specs,docs,insights}`
folders to a whole-working-copy recursive `.md` walk, with a named
exclusion-directory constant and a named document-count cap, deriving each
document's `type` from a path-segment heuristic instead of "which of three known
folders it sat under". Re-root path containment from `<clone>/.devdigest` to the
working-copy root. Do all of this **without changing the identity path shape of
already-attached documents** (EC-21 / AC-2a) and **without breaking a single
existing fixture or test** — the amendment's hardest requirement.

"Done" means: AC-1, AC-1a, AC-2, AC-2a, AC-3, AC-4, AC-5 and AC-16 (traversal)
are satisfied by the code and observable by the verification method each names;
every existing `*.it.test.ts`, seed and e2e fixture that writes under
`.devdigest/{specs,docs,insights}/` still classifies and still resolves
identically without being rewritten (EC-21); a repository with only a root
`README.md` shows one `docs`-typed document (EC-22); and a pathological repo
surfaces at most the cap and reports itself truncated (NFR-13), visibly (the new
`context.footer.truncated` state).

## Requirements reviewed

Per root `CLAUDE.md`'s "Before answering" order:

- **`specs/`** — `specs/2026-08-25-project-context.md`, read in full, focusing on
  the Amendment note and every section it enumerates: G-1, the reversed Non-goal,
  US-1, AC-1…AC-5 + AC-1a/AC-2a, EC-1/EC-2 + EC-20/EC-21/EC-22/EC-23, NFR-5
  (caveated), NFR-8 (new), NFR-13 (new), Contract changes, Inputs and provenance,
  Untrusted inputs (§ Boundary validation, re-rooted), Server § Adapters, Client
  § Copy and § States, Open questions 6/7/8. Also `specs/04-blast-radius.md` (the
  "visible cap, never a silent short list" principle NFR-13 cites) and
  `specs/01-skills.md` (unchanged; resolution/attachment axes are out of scope).
- **`docs/`** — no new `docs/` content bears on discovery; the section-order and
  prompt-assembly docs (`docs/agent-prompts/README.md`) are downstream of
  discovery and explicitly unchanged by this amendment.
- **`INSIGHTS.md`** — root (the two vendored `@devdigest/shared` copies are
  independent files with no sync script, 2026-08-04 — still governs the one
  `describe()`-string contract edit; the authoring/review skill-load split,
  2026-08-24). `server/INSIGHTS.md` (2026-08-14 grouped-aggregate query pattern —
  still how `used_by_agents` is computed, unchanged here; 2026-08-21 barrel
  near-synonym trap — relevant if the truncation field adds an export).
- **Source, read directly against the working tree (not the spec's prose)** —
  `server/src/adapters/context-docs/fs.ts` (the real `list`/`walk`/`read`/
  `resolveContained`); `server/src/adapters/context-docs/types.ts`
  (`typeForContextDocPath`, `ContextDocMeta`, `ContextDocsPort`, the two error
  classes); `server/src/adapters/mocks.ts` (`MockContextDocsPort`);
  `server/src/modules/repo-intel/constants.ts` (`EXCLUDED_DIRS` at `:17-26`,
  `MAX_INDEXED_FILES = 5000` at `:48`); `server/src/vendor/shared/contracts/platform.ts`
  (`ContextDocType`, `SpecFile`, `IndexStatus` at `:262-301`);
  `server/src/modules/project-context/service.ts` (how `m.path` flows to the
  contract and the `used_by_agents` map); `server/test/project-context.it.test.ts`,
  `server/test/context-docs-run.it.test.ts`, `server/src/db/seed.ts`,
  `e2e/specs/10-project-context.flow.json` (every fixture path shape);
  `client/messages/en/context.json` and `client/src/lib/hooks/core.ts:124-136`.

## Scope & Modules

| Package | Touched | Why |
|---|---|---|
| `server/` (pnpm) | **yes** | The adapter (`fs.ts` `list`/`walk`/type-derivation/containment), `types.ts` (`typeForContextDocPath` re-shaped, error-message text, port doc), the exclusion + cap **named constants**, `MockContextDocsPort` (walk-time truncation parity), one `describe()`-string contract edit on `SpecFile.path`, and — if the truncation signal needs a home — one additive contract field + its producer in the project-context service. Discovery unit + integration tests. |
| `client/` (pnpm) | **yes** | Reword the three `.devdigest`-naming strings; add `context.footer.truncated`; render the new "truncated" list state; contract mirror if the truncation field lands. No new hook, no new route, no attach-panel change. |
| `e2e/` (npm) | **no** | The existing flow (`10-project-context.flow.json`) keeps passing under EC-21 and needs no change. A truncated-state e2e is not worth a mutating flow; the state is covered by a hermetic client test. |
| `reviewer-core/` | **no** | Downstream of discovery; untouched, as the amendment states. |
| `mcp-server/` | **no** | Unrelated surface. |

## What this amendment does NOT change (so plan-verifier does not re-litigate)

The base build shipped and was verified. **Only AC-1, AC-1a, AC-2, AC-2a, AC-3,
AC-4, AC-5 and AC-16 (the traversal-containment half) are new or changed by this
amendment.** Everything else in the 46 is already "Met" against `06dd55b` + the
uncommitted base build and is out of scope here:

- Attachment, storage, ordering, dedup, run-time resolution, injection, the
  omit-when-empty spread, the trace block, `used_by_agents` semantics,
  `context_doc_count`, versioning-is-a-no-op — **all unchanged** (AC-13 … AC-46
  except the AC-16 traversal clause). The resolver reads a *path*; it does not
  read discovery *scope*. Confirmed against `service.ts` and the spec's Contract
  changes § ("nothing in the attach / resolve / inject chain reads the discovery
  scope").
- The `ContextDocType` enum, the `SpecFile`/`ContextDocLink`/`SetContextDocsBody`
  shapes, `knowledge.ts`, `trace.ts` — **no shape change**. The only contract
  edits this amendment permits are (a) a one-line `SpecFile.path` `describe()`
  fix and (b) *possibly* one additive nullish set-level field for NFR-13 (see the
  Contract-first decision below).
- The three UI surfaces (N6 page structure, agent/skill Context tabs), all hooks,
  the nav entry, the attach panel — **unchanged** except the three reworded
  strings and the one new footer state.

`plan-verifier` on this pass should verify the eight changed ACs and the two
hard compatibility properties (EC-21, EC-23) — and should treat the other 38 as
already-Met, not re-open them.

## Architectural Constraints

- **onion-architecture.** All discovery work stays in the outer ring
  (`server/src/adapters/context-docs/`), the only place `node:fs` appears for
  this feature. The service (`service.ts`) and routes are untouched by discovery
  itself — they already call `contextDocs.list()` / `.read()` and pass `m.path`
  straight to the contract. The truncation signal, if it lands, is set in the
  service from an adapter-returned flag, never computed in a route.
- **The path-identity invariant is the load-bearing constraint of this whole
  amendment, and the spec's prose hides it.** Today `list()` returns
  `path: \`${type}/${relPath}\`` (`fs.ts:60-61`) — it *strips* the
  `.devdigest/<type>` prefix, so `.devdigest/specs/public-api.md` on disk lists
  as `specs/public-api.md`. Every stored attachment, every seed fixture, every
  `*.it.test.ts` payload and the e2e flow use that stripped form as the document
  **identity** (`context-docs-run.it.test.ts` attaches `specs/public-api.md`;
  `seed.ts` writes `SPECS_FIXTURE_PATH = 'specs/public-api.md'`). A naive
  whole-repo walk that returns the *true* repo-relative path would list that same
  file as `.devdigest/specs/public-api.md` — a **different string** — silently
  detaching every existing attachment and breaking AC-2a / EC-21 / AC-17. **The
  amendment cannot change the identity path shape for files that used to live
  under `.devdigest/<type>/`.** Two ways to satisfy this, decided under
  "Recommendations R-A"; the plan's default preserves the stripped shape for the
  `.devdigest` layout and uses the true repo-relative path only for files the old
  code never surfaced. This is the single thing most likely to be gotten wrong,
  so Step 1 makes it a test before it makes it a walk.
- **postgresql-table-design / drizzle-orm-patterns — not needed.** No schema
  change (the spec's Server § confirms: "No schema change is introduced by this
  amendment"). `context_doc_links` is untouched.
- **Contract-first ordering (conditional).** IF the NFR-13 truncation signal
  lands as a contract field (see decision below), it is a `@devdigest/shared`
  change and must go server-canonical → `./scripts/check-contracts.sh --fix` →
  `cd client && pnpm typecheck` **before** any client step that reads it, per
  root `CLAUDE.md` and the base plan's Step 3 rationale. The `SpecFile.path`
  `describe()` fix rides in the same server-canonical edit.
- **Package managers.** `server/` + `client/` = pnpm; `e2e/` = npm (not touched).
- **Hermetic test split.** New discovery unit tests are hermetic and run with
  `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`. The
  `*.it.test.ts` additions and the existing e2e flow are deferred to CI unless
  Docker is available locally. Never `pnpm test` in `server/`.
- **Do-not-touch.** `server/clones/**` is both an *exclusion-list entry* for this
  walk (EC-20: `server/clones` matched relative to the working-copy root) and a
  path this repo's own agents must never grep/read — the constant is exactly the
  belt-and-braces the root `CLAUDE.md` wants.

### The Contract-first decision this plan owns (spec Open question 8, NFR-13)

The spec defers "where the NFR-13 truncation signal lives in the contract" to the
planner. `SpecFile` is per-document and cannot carry a set-level "truncated /
showing N of many" flag; the list route returns a **bare `SpecFile[]`**
(`GET /repos/:id/context` → `SpecFile[]`, `core.ts:127`), which has no room for a
sibling field. Three options and the call:

- **(A) Reuse `IndexStatus`.** Rejected: `IndexStatus` is the *reindex* response
  (`POST …/context/reindex`), not the *list* response; the truncation is a
  property of the list, and the client reads the list on every page load, not
  only after a reindex. Bolting a `truncated` count onto `IndexStatus` would make
  the flag arrive on the wrong request.
- **(B) A response header** (e.g. `x-context-truncated`). Rejected: the client
  data layer is `api.get<SpecFile[]>` (`core.ts:127`) returning a parsed body;
  threading a header through TanStack Query means bypassing the typed contract,
  which is exactly what `@devdigest/shared` exists to prevent.
- **(C, chosen) Change the list response to a small envelope.** Add
  `SpecFileList = z.object({ files: z.array(SpecFile), truncated: z.boolean(),
  shown: z.number().int() })` (names indicative) in
  `contracts/platform.ts`, and change `GET /repos/:id/context`'s response from
  `SpecFile[]` to `SpecFileList`. This is the **smallest additive change that
  keeps the truncation visible in the typed contract** (NFR-13's requirement) and
  the only one that puts a set-level flag on the request that actually carries the
  set. It is a contract *shape* change to an existing response, so it triggers
  `response-schema` and the contract-first ripple: `useContextFiles`
  (`core.ts:124-127`) changes its generic from `SpecFile[]` to `SpecFileList` and
  every reader of the list unwraps `.files`. Because the list endpoint's sole
  producer is the project-context service written in the base build (no external
  consumer, no published version), this is not a breaking-change event under
  `semver-discipline` — it is an additive envelope on an internal contract, the
  same reasoning the base plan applied to `SpecFile.type`.

  **Blast radius of (C), named so it is not a surprise:** `useContextFiles`
  callers (the N6 page's `ProjectContextView` and both Context tabs, which derive
  the "N of M attached" badge from the list) must unwrap `.files`; the base
  build's `project-context.it.test.ts` AC-1 assertion (`docs.find(...)` over a
  bare array) must read `.files`. That test edit is the *one* place this
  amendment does touch an existing `*.it.test.ts`, and it is a mechanical unwrap,
  not a fixture rewrite — EC-21's "without being rewritten" is about the
  `.devdigest` *fixture data*, not about a response-shape unwrap, so this does not
  violate it. If the spec owner would rather keep the bare array and accept a
  header, that is option (B) and a spec question — raised in Open questions.

## Execution Mode

**Multi-agent pipeline** (the default), run by `/run-plan`
(`.claude/skills/run-plan/SKILL.md`): `implementer` executes the Steps in order,
then `plan-verifier` + `architecture-reviewer` in parallel, then the fix loop.
The Steps and skill assignments are identical under a single-agent pass; only who
reviews differs. `/run-plan` skips `test-writer` by default, so the discovery
unit test in Step 1 and the `*.it.test.ts` additions in Step 4 are **deliverables
of those steps**, not a later pass (see Open questions Q-A). Because eight ACs
name a test as their verification method and six of those are hermetic units, the
per-step `tests:` commands are the gate.

## Steps

Ordered so shared skill sets are contiguous, and so the backward-compat *test*
lands before the walk it constrains. The conditional contract change (if option C
is taken) leads, because contract-first is a hard dependency.

### Group 1 — the discovery adapter (onion-architecture)

1. **Pin the backward-compat classification and the identity-path invariant as
   hermetic tests, then re-shape `typeForContextDocPath`.** — files:
   `server/src/adapters/context-docs/types.ts`,
   `server/src/adapters/context-docs/fs.test.ts` (new hermetic unit test; the
   adapter has only `*.it.test.ts` coverage today, and the AC-1a/AC-2/AC-2a/AC-3
   heuristic is pure logic that must be unit-tested without a clone).
   Replace `typeForContextDocPath`'s "first segment ∈ {specs,docs,insights}"
   check with the **AC-2 heuristic**: base name `insights.md` (case-insensitive)
   → `insights`; else scan the file's own directory segments nearest-to-file
   toward the root and take the first `specs` or `docs` segment (case-insensitive)
   → that type; else `docs`. It now **always returns a `ContextDocType`, never
   `undefined`** — so its old double duty as the "traversal signal" is removed
   (containment moves fully to the `realpath` gate, Step 3). Update the error
   classes' message text (`ContextDocTraversalError` says "outside the .devdigest
   directories" → "outside the working-copy root") and the port doc comment.
   Tests assert: `insights.md` at any depth → `insights` (AC-2); nested
   `.devdigest/specs/x.md`, `.devdigest/docs/x.md`, `.devdigest/insights/x.md`,
   plain `docs/x.md`, plain `specs/x.md` all classify as before (AC-2a, EC-21);
   a root `README.md` → `docs` (AC-2, EC-22); the identity-path shape of a
   `.devdigest`-layout file is unchanged (the invariant in Architectural
   Constraints — see R-A for how the walk preserves it). — skills:
   [onion-architecture] — tests:
   `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`
   — **ACs: AC-2, AC-2a, AC-3 (extension gate), EC-21, EC-22**

2. **Add the exclusion-list and count-cap named constants.** — files:
   `server/src/adapters/context-docs/constants.ts` (new).
   Define `EXCLUDED_DIRS` for this feature as its **own exported constant**, not
   an import of `repo-intel`'s (see R-B for why): the EC-20 list — `node_modules`,
   `.git` (matched by name at any depth so nested submodule `.git` dirs are
   pruned), `dist`, `build`, `out`, `coverage`, `.next`, `vendor` — plus
   `server/clones` matched **relative to the working-copy root** (the one
   rooted-path entry). Define `MAX_CONTEXT_DOCS` (the NFR-13 cap) as a named
   constant; propose `5000` mirroring `repo-intel`'s `MAX_INDEXED_FILES` but see
   R-C on why a *lower* value (e.g. 1000) is defensible for a *list-and-fan-out*
   surface versus an *index* surface. One constant each, so a future addition is a
   one-line change (EC-20's explicit requirement). — skills: [onion-architecture]
   — tests: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`
   — **ACs: supports AC-1a (EC-20), NFR-13**

3. **Rewrite `FsContextDocsAdapter.list()`/`walk()` to a whole-working-copy walk,
   re-root containment, keep both symlink gates.** — files:
   `server/src/adapters/context-docs/fs.ts`.
   `list(clonePath)` walks `clonePath` recursively instead of the three fixed
   `.devdigest/<type>` roots. In `walk()`: skip any entry that
   `isSymbolicLink()` (retain `fs.ts:50` — EC-23 gate 1); skip any directory whose
   **name** is in `EXCLUDED_DIRS` (EC-23 gate 2) and, for the `server/clones`
   entry, whose working-copy-root-relative path matches — **prune before
   recursing, never after** (NFR-5's early-termination requirement, spec Open
   question 7); keep only `.md` (case-insensitive, AC-3); derive `type` via the
   Step 1 heuristic (AC-2); **preserve the identity-path shape per R-A** (default:
   for a file under `.devdigest/<type>/`, emit the historic `\`${type}/${rel}\``
   form; otherwise emit the true repo-relative path). Stop after `MAX_CONTEXT_DOCS`
   discoverable `.md` files and return a `truncated` signal alongside the list
   (NFR-13). **Sort the result by repository-relative path** so discovery order
   never depends on `readdir` enumeration order (NFR-8). Re-root `resolveContained`
   from `join(clonePath, DEVDIGEST_DIR)` to `clonePath` itself: drop the "first
   segment ∈ {specs,docs,insights}" lexical gate (a path may now legitimately
   start with anything), and keep the `realpath`-before-read containment check now
   rooted at the working copy — an absolute path, a `..` escape or a symlink whose
   real path leaves the working copy is still rejected before any `readFile`
   (AC-4, AC-16). An absent/empty working copy still yields `[]` (AC-5). — skills:
   [onion-architecture] — tests:
   `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`
   — **ACs: AC-1, AC-1a, AC-3, AC-4, AC-5, AC-16 (traversal), NFR-8, NFR-13**

4. **Mock parity + DB-backed integration coverage of the widened walk.** — files:
   `server/src/adapters/mocks.ts` (`MockContextDocsPort`),
   `server/test/project-context.it.test.ts` (extend the existing AC-1/AC-5 cases),
   `server/test/context-docs-run.it.test.ts` (extend if option C changes the list
   shape it asserts on).
   `MockContextDocsPort.list()` must return the same `{ ...ContextDocMeta,
   truncated }`-shaped result the real adapter now returns (and honour the cap if a
   test sets more than `MAX_CONTEXT_DOCS` files) so the fake keeps AC-1…AC-5
   testable without a clone. Extend `project-context.it.test.ts` to prove: a `.md`
   file **outside** `.devdigest` (e.g. a root `README.md` and a `docs/guide.md`
   not under `.devdigest`) now appears in the list and classifies correctly
   (AC-1, AC-2, EC-22); a file under an **excluded** directory
   (`node_modules/foo/x.md`, a nested `sub/.git/x.md`,
   `server/clones/whatever/x.md`) is **omitted** (AC-1a, EC-20); the existing
   `.devdigest/specs/public-api.md` fixture still lists at identity
   `specs/public-api.md` and still resolves (AC-2a, EC-21, AC-17 — the delete/
   re-create case already in the file must still pass unchanged); a symlinked
   excluded dir is not descended (EC-23); and containment now rejects a path that
   escapes the working-copy root while **allowing** a legitimate `.md` next to an
   excluded dir (Untrusted inputs §: the exclusion list shapes the *list*, not what
   may be *read*). **Do not rewrite the existing `.devdigest` fixture data** — add
   new files alongside it (EC-21 is a hard requirement, and its whole point is that
   the current fixtures keep passing). — skills:
   [onion-architecture, fastify-best-practices] — tests:
   `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` (mock parity is
   hermetic); `cd server && pnpm exec vitest run .it.test` (Docker; else CI)
   — **ACs: AC-1, AC-1a, AC-2a, AC-4, AC-5, AC-16, AC-17 (regression), EC-20, EC-21, EC-23**

### Group 2 — the conditional contract change (zod + response-schema) — ONLY if option C

5. **(Conditional on the truncation-signal decision landing as option C.) Envelope
   the list response and fix the `SpecFile.path` describe-string.** — files:
   `server/src/vendor/shared/contracts/platform.ts`.
   Add `SpecFileList { files: SpecFile[], truncated: boolean, shown: number }`
   (names indicative; grep the barrel for near-synonyms first — the barrel has no
   collision check, `server/INSIGHTS.md` 2026-08-21). Fix `SpecFile.path`'s
   `.describe()` from "…under .devdigest/{specs,docs,insights}" to "Repository-
   relative path" (spec Contract changes §; a doc-string change,
   `semver-discipline` does not count it as a surface change), and drop the now-
   false `.devdigest`-subdirectory comment on `SpecFile.type`. The `describe()`
   fix rides here **regardless of option C** — if the spec owner picks a
   non-contract truncation route, this Step shrinks to the one-line `describe()`
   edit and `SpecFileList` is not added. — skills: [zod, response-schema] — tests:
   `cd server && pnpm typecheck`
   — **ACs: NFR-13 (contract home); SpecFile.path describe accuracy**

6. **(Conditional, paired with Step 5.) Wire the envelope through the service,
   route, contract-sync and the client generic.** — files:
   `server/src/modules/project-context/service.ts` and `.../routes.ts` (return
   `SpecFileList`, set `truncated`/`shown` from the adapter's flag),
   `client/src/vendor/shared/**` (written by `./scripts/check-contracts.sh --fix`,
   never hand-edited), `client/src/lib/hooks/core.ts` (`useContextFiles` generic
   `SpecFile[]` → `SpecFileList`), and the list's readers (`ProjectContextView`
   and both Context tabs) to unwrap `.files`.
   Contract-first: server canonical (Step 5) → `./scripts/check-contracts.sh
   --fix` → `cd client && pnpm typecheck` before the client reads it — the base
   plan's Step 3 dashed-edge trap applies unchanged. — skills:
   [response-schema, fastify-best-practices] — tests:
   `./scripts/check-contracts.sh` (clean) · `cd server && pnpm typecheck` ·
   `cd client && pnpm typecheck`
   — **ACs: NFR-13 (visible signal, server + wiring)**

### Group 3 — client copy and the truncated state (frontend-ui-architecture + react)

7. **Reword the `.devdigest`-naming strings and add the truncated footer key.** —
   files: `client/messages/en/context.json`.
   Reword `empty.body` (drop "under .devdigest/specs/" → describe repository-wide
   discovery with vendored/build dirs excluded) and `notSynced.body` (drop "its
   .devdigest/ documents" → "its documents"). `attach.orderHint` does **not**
   name `.devdigest`, so it is left as-is (verified against the file). Add
   `footer.truncated` — the "showing {shown} of many" signal (NFR-13). No inline
   literals; keys only. — skills: none (message catalog) — tests:
   `cd client && pnpm test` (existing suites stay green)
   — **ACs: US-1 copy; NFR-13 copy; spec Client § Copy amendment**

8. **Render the truncated list state on the N6 page.** — files:
   `client/src/app/repos/[repoId]/context/_components/ProjectContextView/ProjectContextView.tsx`
   (and its `.test.tsx`).
   Add the "truncated" row from the spec's States table: when the list response
   reports `truncated`, show `context.footer.truncated` ("showing N of many") —
   never a silently short list (NFR-13, the `specs/04-blast-radius.md` visible-cap
   principle). The test asserts the signal renders when `truncated` is set and is
   absent otherwise. Depends on Step 6 having landed the field (or, under a
   non-contract route, on however the flag arrives). — skills:
   [frontend-ui-architecture, react-best-practices, react-testing-library] —
   tests: `cd client && pnpm test`
   — **ACs: NFR-13 (visible client state); spec Client § States "truncated" row**

## Step groups by skill set

One load per group, per `.claude/skills/README.md` ("at most once per session").

- **Steps 1–4** — `onion-architecture` (Step 4 adds `fastify-best-practices` for
  the route-level integration test). This is the whole discovery change and leads
  because the backward-compat test (Step 1) must gate the walk (Step 3).
- **Steps 5–6** — `zod` + `response-schema` (Step 6 adds `fastify-best-practices`,
  carried from Step 4). **Conditional** — only if the truncation signal lands as
  contract option C. Contract-first forces this group before Step 8.
- **Steps 7–8** — `frontend-ui-architecture` + `react-best-practices` +
  `react-testing-library` (Step 7 needs none — message catalog only).

## Skills to apply

Sourced from the "Authoring load vs review load" table in
`.claude/skills/README.md`. Contract for whoever executes the plan.

| Step | Skills |
|---|---|
| 1 | onion-architecture |
| 2 | onion-architecture |
| 3 | onion-architecture |
| 4 | onion-architecture, fastify-best-practices |
| 5 (conditional) | zod, response-schema |
| 6 (conditional) | response-schema, fastify-best-practices |
| 7 | — (message catalog) |
| 8 | frontend-ui-architecture, react-best-practices, react-testing-library |

`response-schema` is assigned at Steps 5–6 because the list response is an
**existing** contract changing shape (bare array → envelope) — the change-impact
trigger. `semver-discipline` and `deprecation-policy` are **not** assigned:
nothing is removed, renamed, retyped or narrowed; the envelope is additive on an
internal contract with a single in-repo producer and no published version, the
same reasoning the base plan applied to the (new, required) `SpecFile.type`.
`typescript-expert`, `security` and `pr-self-review` are **not** assigned to any
step — they are review lenses in `pr-self-review`'s fan-out. No step's own work
is type-level. `postgresql-table-design`/`drizzle-orm-patterns` are **not**
assigned — no schema change.

## Recommendations

Improvements on the spec's implementation *shape*. None change scope; each names
what a literal reading would do and what I would do instead.

- **R-A — preserve the identity-path shape for `.devdigest`-layout files; use the
  true repo-relative path only for newly-discoverable files.** This is the
  critical one. A literal reading of the amendment ("return a path relative to the
  working-copy root, no longer prefixed with a fixed type directory", Server §
  Adapters) would change `.devdigest/specs/public-api.md`'s listed identity from
  `specs/public-api.md` to `.devdigest/specs/public-api.md`, silently detaching
  every existing attachment and failing AC-2a/EC-21/AC-17. The default in Step 3
  is therefore: **if a discovered file's path is `.devdigest/<specs|docs|insights>/…`,
  emit the historic `\`${type}/${rest}\`` identity; otherwise emit the true
  repo-relative path.** This keeps every existing attachment resolving and lets new
  files (e.g. `docs/guide.md` outside `.devdigest`, a root `README.md`) use their
  natural path. The alternative — a one-time migration rewriting stored
  `context_doc_links.path` rows to the `.devdigest`-prefixed form — is more code, a
  migration the spec explicitly says this amendment does not introduce (Server §:
  "No schema change"), and pointless churn given no external consumer. **This is a
  behaviour decision the spec owner should confirm**, because it makes the listed
  path shape *non-uniform* (stripped for `.devdigest`, full otherwise). If uniform
  paths are wanted, that is the migration route and a spec question — raised in
  Open questions. The Steps implement the shape-preserving default until told
  otherwise.
- **R-B — define this feature's `EXCLUDED_DIRS` as its own constant, do not import
  `repo-intel`'s.** The spec offers "colocated with the adapter or with
  `repo-intel`'s `EXCLUDED_DIRS` — the plan's call". Take the former.
  `repo-intel`'s list (`constants.ts:17-26`) is tuned for *symbol indexing* and
  does **not** include `server/clones` or the nested-submodule-`.git` semantics
  this feature needs (EC-20 explicitly *extends* it "for this feature's clone
  reality"). Importing it verbatim would miss `server/clones`; extending it in
  place would couple two features' walk scope and risk a repo-intel change silently
  altering document discovery. A local constant that *documents* it mirrors
  repo-intel is the honest shape.
- **R-C — set `MAX_CONTEXT_DOCS` below `MAX_INDEXED_FILES`, not equal to it.** The
  spec calls 5000 "the natural precedent" but leaves the number to the plan. 5000
  is tuned for an *index* (write-once, queried by symbol). This surface is a *list
  rendered in a browser* plus a `used_by_agents` fan-out **per document**
  (`service.ts`) — 5000 rows in a flat list is already unusable (spec Open question
  6 concedes this), and 5000 fan-out subqueries is the unbounded cost NFR-13 exists
  to cap. Propose **1000** as the cap: comfortably above any real project's genuine
  markdown count, an order of magnitude under the pathological case, and it keeps
  the truncated flat list at least scrollable. Named constant either way; the value
  is a one-line change if 1000 proves wrong.
- **R-D — add the hermetic `fs.test.ts` the adapter never had.** Today the adapter
  is covered only by `*.it.test.ts` (Docker-gated). The AC-2 heuristic and the
  EC-20 name-matching are pure string logic; putting them in a hermetic unit test
  (Step 1) means the six hermetic-verified ACs are checked on every local run, not
  only when Docker is up — and `/run-plan` skips `test-writer`, so if this test is
  not a Step deliverable it will not be written at all (Q-A).
- **R-E — prune excluded directories before recursing, and cap during the walk,
  not after.** NFR-5's caveat and Open question 7 both hinge on this: the walk must
  `continue` past an excluded directory *without reading its children*, and must
  stop enqueuing once `MAX_CONTEXT_DOCS` is hit rather than collecting everything
  and slicing. Stated as an implementation requirement in Step 3 so the 500 ms
  bound has a chance and the cap is a real ceiling on work, not just on output.

## Out of scope

- **Spec authoring or spec status changes** — the spec stays `Status: draft`;
  changing it is the spec owner's call and `doc-writer`'s post-ship, not this plan.
- **Architecture and security review** — `architecture-reviewer` and
  `pr-self-review`'s fan-out. `security` will fire by content trigger on
  `adapters/context-docs/fs.ts` (a request-supplied path joined to a filesystem
  read) — expected, not a step here.
- **The 38 already-Met ACs** — attachment, resolution, injection, trace,
  `used_by_agents` semantics, versioning-is-a-no-op, all UI surfaces except the
  three reworded strings and the truncated state. Do not re-litigate.
- **`reviewer-core` changes** of any kind.
- **A migration rewriting stored attachment paths** — the shape-preserving default
  (R-A) makes it unnecessary; if the spec owner wants uniform paths, that is a new
  scope item and a spec question.
- **A truncated-state e2e flow** — covered by a hermetic client test (Step 8); not
  worth a new mutating browser flow.
- **`.gitignore`-following, per-document size caps, attach-set size caps, nesting
  depth** — explicitly still not constrained (NFR-13, Non-goals).
- **Integration and e2e** deferred to CI unless Docker is available locally
  (Step 4's `.it.test`).

## Verification

Run in order; each gates the group above it.

```sh
# Group 1 — discovery adapter (hermetic first, it is the whole point)
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'   # Steps 1–4 mock parity + fs.test.ts
cd server && pnpm typecheck
cd server && pnpm exec vitest run .it.test                      # Step 4 DB-backed; Docker, else CI

# Group 2 — contract (ONLY if truncation option C taken)
cd server && pnpm typecheck
./scripts/check-contracts.sh            # must print "contracts in sync"
cd client && pnpm typecheck

# Group 3 — client copy + truncated state
cd client && pnpm test
cd client && pnpm build

# Regression the whole point of the amendment rests on:
# the existing e2e flow must still pass unchanged (EC-21).
cd e2e && npm run e2e:hermetic          # or ./scripts/e2e.sh; CI e2e-web.yml
```

Two checks no single command frames, both hard requirements of the amendment:

- **EC-21 regression, by hand if needed** — `server/test/project-context.it.test.ts`
  and `server/test/context-docs-run.it.test.ts` must pass **without their
  `.devdigest` fixture data being edited**. If a fixture had to be rewritten to
  make a test green, the identity-path invariant (R-A) was broken — that is a
  failure, not a test-maintenance task.
- **The eight changed ACs, not the 38 shipped ones** — `plan-verifier` should
  confirm AC-1, AC-1a, AC-2, AC-2a, AC-3, AC-4, AC-5, AC-16 (traversal) against
  this plan and treat the rest as already-Met.

Pre-PR, `pr-self-review` will route (per `pr-self-review/routing.md`, canonical
for review): `onion-architecture` on `server/src/adapters/**` and
`server/src/modules/**`; `zod` + `response-schema` on
`server/src/vendor/shared/contracts/**` (only if option C lands);
`frontend-ui-architecture` + `react-best-practices` on `client/src/app/**`;
`react-testing-library` on the client test; `typescript-expert` on every
`.ts`/`.tsx`; and `security` by **content trigger** on
`adapters/context-docs/fs.ts` — the request-supplied-path-to-filesystem-read
trigger fires exactly here, and the re-rooted containment is what it will scrutinise.
`server/src/vendor/shared/**` in the diff (option C) activates the reviewer-core
CI zone as well as server and client, per the base plan's note.

Close-out: run `engineering-insights` per root `CLAUDE.md`. Candidate entries —
the `list()` identity-path invariant (that the listed path shape *is* the
attachment contract, and a whole-repo walk must not change it for legacy
`.devdigest` files); the two-independent-gates rule for excluded-directory
symlinks (EC-23); and the list-vs-index cap-value distinction (R-C).

## Open questions / assumptions

1. **The truncation-signal contract home (spec Open question 8) — chosen option C
   (list-response envelope `SpecFileList`), does not block.** Default implements
   C. If the spec owner prefers to keep the bare `SpecFile[]` and accept a response
   header (option B) or drop the visible-truncation requirement, Steps 5–6 change
   or disappear — that is a spec decision, surfaced here rather than assumed
   silently. The `SpecFile.path` `describe()` fix happens either way.
2. **The identity-path shape (R-A) — assumed shape-preserving for `.devdigest`
   files, does not block, but the spec owner should confirm.** The amendment's
   prose ("no longer prefixed with a fixed type directory") reads as if uniform
   true-repo-relative paths are wanted, but that silently breaks every existing
   attachment (AC-2a/EC-21/AC-17). I have assumed the compatibility requirement
   wins and the listed path shape is non-uniform. If uniform paths are the intent,
   a stored-path migration is needed and that is new scope.
3. **`MAX_CONTEXT_DOCS` value — assumed 1000 (R-C), not the spec's suggested
   5000.** Does not block; a one-line change. Flagged because it deviates from the
   number the spec names.
4. **Q-A — `test-writer` is off by default in `/run-plan`.** The six hermetic-unit
   ACs and the `*.it.test.ts` additions are made deliverables of Steps 1 and 4. If
   the implementer skips them, those ACs ship unverified and `plan-verifier` will
   find the gap — recorded here so the choice is visible up front.
5. **NFR-5's 500 ms bound on a pathological wide-but-shallow tree (spec Open
   question 7) — not settled by this plan, mitigated by R-E.** The plan requires
   prune-before-recurse and cap-during-walk, which is the most the discovery layer
   can do; whether 500 ms actually holds needs one timed `list()` against a large
   real repo, which is a measurement, not a code decision. If it fails, NFR-5 gains
   a "measured against a typical checkout" caveat — a spec edit, not a plan one.
