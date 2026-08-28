# Spec: PR Brief card

**Spec ID:** SPEC-cross-06
**Status:** shipped
**Created:** 2026-08-27
**Packages touched:** server, client
**Supersedes:** none — but repurposes the dead `PrBrief` type and `pr_brief` table (see Naming)
**Design sources:**
- Prose brief from the requester (the raw ask, translated from Ukrainian) — authoritative on intent.
- Two rendered mockup screenshots, transcribed by the requester — secondary, cross-checked below. **They are NOT corroborated by the attached HTML** (see the note under Design source verification).
- `/home/imiasoid/Downloads/DevDigest Design (standalone) (3).html` — grepped, not read whole. Contains an artboard labelled `PR Detail · Overview (Brief)` but **none** of the PR Brief card's fields (`risk_level`, `review_focus`, `what`/`why`, "review focus", "PR score", "request changes"). Treated as a stale/earlier mockup that does not depict this card.
- Code analysed (authoritative on current behaviour): `server/src/vendor/shared/contracts/brief.ts`, `contracts/findings.ts`, `contracts/pr-blast.ts`, `server/src/modules/reviews/intent-classifier.ts`, `intent-signals.ts`, `server/src/modules/pulls/routes.ts` (:454–479), `server/src/modules/reviews/routes.ts`, `server/src/db/schema/reviews.ts` (:48–75), `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`, `client/src/lib/hooks/reviews.ts` (:234–249).

> **Design source verification.** The single occurrence of "brief" in the
> attached HTML is an artboard *title* (`PR Detail · Overview (Brief)`), not the
> card. The card the requester's screenshots describe — score gauge, verdict
> pill, "review focus" list — is absent from the HTML. **Confirmed with the
> requester (2026-08-27): the screenshot transcription is accepted as the
> source of record** for this card's layout; no separate mockup/Figma link is
> pending.

---

## Problem & user

A reviewer opening a PR's Overview tab today sees two panels — Intent (what the
PR claims to do) and Blast Radius (what it structurally reaches) — plus the raw
description. To decide *where to spend the first five minutes of review*, they
must synthesise those two panels, the diff stats, the linked issue, and any
relevant specs in their head, every time, for every PR.

Nothing on the page answers "given all of that, what is the one-paragraph story
of this change and which two or three files should I read first?" The Intent
Layer states the author's claim; Blast Radius states the graph's facts; neither
distils them into a reviewer-facing brief with an explicit, clickable
read-these-first list.

The user is the **reviewer** at the moment they open a PR, before they have read
any code.

## Goals / Non-goals

**Goals**

- A **PR Brief card** at the top of the Overview tab that distils existing
  signals (Intent, Blast Radius summary, diff stats, linked issue, relevant
  specs) into `{ what, why, risk_level, risks[], review_focus[] }` via one
  structured LLM call.
- **Grounding:** every `risks[]` and `review_focus[]` item may reference only
  files or endpoints that appear in the LLM call's input data. No hallucinated
  paths.
- The result is **cached per PR state** (keyed by head SHA) and a separate
  control triggers regeneration — mirroring the shipped PR Intent Layer's
  cached-GET / forced-refresh split.
- `PrBriefCard` renders the risk level and a **clickable** list of review-focus
  items (SHA-pinned `file:line` links, the existing `githubBlobUrl` pattern).
- Diff **hunk bodies are never sent to the model** — only stats and shape
  (paths, additions/deletions, hunk headers), reusing the Intent Layer's
  `buildDiffShape` discipline.

**Non-goals**

- **Generating a PR score, verdict, cost, or token count inside the Brief LLM
  call.** These already exist in the shipped `Review` contract
  (`contracts/findings.ts`: `verdict`, `score` 0–100, `findings[]`). Duplicating
  them in the Brief call risks two disagreeing scores for one PR. **Confirmed
  with the requester (2026-08-27): the card displays these from the existing
  latest `Review` — it does not ask the Brief LLM call to produce them.**
- **A new severity/verdict vocabulary for findings.** `risk_level` is a
  PR-level risk scale (see Contract changes); it does not replace `Severity` or
  `Verdict`.
- **Re-running Intent (L03) or Blast (L04) as part of brief generation.** The
  Brief consumes their cached output; it does not compute them. Degradation when
  they are missing is specified in Edge cases, not worked around by triggering
  them.
- **Sending diff line content to the model.** Out, permanently — matches the
  Intent Layer's hard constraint and this repo's security posture.
- **A standalone Brief tab or route in the nav.** The card lives in the existing
  Overview tab only.

## User stories

- **US-1.** As a reviewer, I want a one-paragraph "what and why" for the PR at
  the top of the Overview tab, so that I understand the change before reading
  any code.
- **US-2.** As a reviewer, I want an explicit, clickable "review focus" list, so
  that I know which files to open first and can jump straight to them.
- **US-3.** As a reviewer, I want a single PR-level risk level on the card, so
  that I can triage how much scrutiny this PR needs at a glance.
- **US-4.** As a reviewer, I want the brief to reference only real files and
  endpoints from this PR, so that I never chase a path the model invented.
- **US-5.** As a reviewer, I want the brief to load instantly from cache and
  regenerate only when I ask or when the PR changes, so that I am not paying for
  an LLM call on every tab open.
- **US-6.** As a reviewer looking at a PR whose intent, blast, issue, or specs
  are missing, I want a brief that still renders and tells me it was built from
  partial inputs, so that I am not shown a confident brief built on nothing.

## Acceptance criteria (EARS)

**AC-1 (US-5) — verify: `*.it.test.ts`.** WHEN a client requests the cached
brief for a PR that has never had one generated, the system shall return a
"no brief yet" response (a `null` body) without making any LLM call.

**AC-2 (US-5) — verify: `*.it.test.ts`.** WHEN a client requests a fresh brief
via the regenerate route, the system shall make exactly one structured LLM call
and persist the result keyed to the PR's current head SHA.

**AC-3 (US-5, EC-5) — verify: hermetic unit test.** WHILE a cached brief's
stored head SHA equals the PR's current head SHA, the system shall serve the
cached brief and shall not make an LLM call.

**AC-4 (US-5, EC-5) — verify: hermetic unit test.** IF a cached brief's stored
head SHA differs from the PR's current head SHA, THEN the system shall mark the
served brief as stale so the card can offer regeneration.

**AC-5 (US-5) — verify: `*.it.test.ts`.** IF the regenerate route is called more
than the rate-limit budget within its window, THEN the system shall reject the
excess call with HTTP 429, matching the Intent refresh route's `{ max: 10,
timeWindow: '1 minute' }`.

**AC-6 (US-1) — verify: contract check.** The Brief LLM call shall return exactly
`{ what, why, risk_level, risks[], review_focus[] }` and no score, verdict, cost,
or token-count field.

**AC-7 (US-4, EC-1) — verify: hermetic unit test.** IF a generated `risks[]` or
`review_focus[]` item references a file path or endpoint that does not appear in
the brief's input data, THEN the system shall drop that item before persisting,
so a stored brief never contains an ungrounded reference.

**AC-8 (US-4) — verify: hermetic unit test.** The system shall assemble the LLM
input from the PR's diff **stats and shape only** (paths, additions/deletions,
hunk headers) and shall never include diff line content.

**AC-9 (US-2) — verify: e2e flow.** WHEN a reviewer clicks a `review_focus[]`
item, the system shall open the referenced `file:line` at the SHA the brief was
generated against (`githubBlobUrl(..., <brief head SHA>, ...)`), not at an
arbitrary head.

**AC-10 (US-3) — verify: hermetic unit test.** The card shall render exactly one
`risk_level` value drawn from the defined risk-level enum.

**AC-11 (US-6, EC-2) — verify: `*.it.test.ts`.** IF the PR has no cached Intent
or no cached Blast Radius when a brief is generated, THEN the system shall
generate the brief from whichever inputs are present and shall record which
inputs were used, rather than failing or blocking on their computation.

**AC-12 (US-6, EC-3) — verify: hermetic unit test.** IF the PR body resolves no
linked issue and no relevant specs, THEN the system shall still generate a
brief and shall mark those inputs as absent, rather than returning an error.

**AC-13 (US-6) — verify: hermetic unit test.** WHILE a brief was generated from
partial inputs, the card shall show a signals-used / partial indicator, so a
reviewer is never shown a confident brief without knowing what it omitted.

**AC-14 (US-1) — verify: e2e flow.** WHILE no brief has been generated for a PR,
the card shall render an empty state with a generate control, not a spinner that
never resolves and not a blank card.

**AC-15 (US-4) — verify: hermetic unit test.** IF the PR-authored input (title,
body, resolved issue/spec content) contains text that reads as an instruction to
the model, THEN the system shall pass it inside an untrusted-data wrapper
(`wrapUntrusted`) and the system prompt shall instruct the model to treat it as
data, never instructions — matching `intent-signals.ts`.

## Edge cases

- **EC-1 — Ungrounded reference.** The model returns a `review_focus` item
  pointing at `src/made-up.ts`, absent from the input. Defined behaviour: dropped
  before persist (AC-7). The grounding set is the union of file paths and
  endpoint labels present in the assembled input (diff shape paths, Blast summary
  files/endpoints, resolved issue/spec references).
- **EC-2 — Intent or Blast not yet computed.** Brief runs on the inputs that are
  present and records which were used (AC-11). It does not trigger L03/L04.
- **EC-3 — No linked issue and no matching specs.** Brief still runs; those
  inputs marked absent (AC-12).
- **EC-4 — Thin PR (no body, no resolvable references, only diff shape).** Brief
  runs from diff shape alone; `risk_level` and `review_focus` may be sparse. The
  card must not imply certainty it does not have — the partial indicator (AC-13)
  covers this.
- **EC-5 — Head SHA moved after caching.** Served brief marked stale (AC-4); card
  offers regeneration. The stored `file:line` links stay pinned to the SHA the
  brief was generated against (AC-9) until regenerated.
- **EC-6 — Empty vs missing.** An empty `review_focus[]` means "generated, and
  nothing rose to read-first". It must be visually distinct from "no brief yet"
  (AC-14) and from "partial inputs" (AC-13). Three distinct states, not one.
- **EC-7 — Long/overflowing content.** A `what`/`why` paragraph or a
  `review_focus` description longer than the card's width. The card shall not
  clip silently; it wraps or truncates with an affordance. (Undecided detail →
  OQ-4.)
- **EC-8 — Many risks / review-focus items.** If the model returns a large list,
  the card shows a bounded number with a visible "N of M" rather than a silent
  cap — the silent-truncation failure mode this repo has been bitten by
  (`specs/04-blast-radius.md` §1, root `INSIGHTS.md`). (Cap value → OQ-3.)
- **EC-9 — review_focus vs risks relationship.** The mockup shows 4 review-focus
  items while a separate pill reads "6 findings · 2 blockers"; those numbers come
  from different sources (review pipeline vs this brief) and are not expected to
  match. **Confirmed with the requester (2026-08-27): `risks[]` and
  `review_focus[]` are independent, separately-grounded lists** — a risk is not
  required to also appear as a focus item, or vice versa.

## Non-functional requirements

- **Cost.** Exactly one structured LLM call per generation (AC-2). Cached reads
  make zero LLM calls (AC-1, AC-3). Not otherwise constrained on latency beyond
  "cached read is a single DB round trip", matching `getCached`.
- **Rate limit.** Regenerate route: `{ max: 10, timeWindow: '1 minute' }`,
  identical to `/pulls/:id/intent/refresh` (AC-5). Per this repo's security
  skill, AI-generation endpoints are rate-limited.
- **Input size.** Resolved spec content is capped at the Intent Layer's
  `MAX_SPEC_CHARS` (4000) per reference; reference extraction capped at
  `MAX_REFS_PER_KIND` (3) per kind — reuse, do not re-invent.
- **Grounding.** Post-generation grounding filter (AC-7) is mandatory, not
  advisory. A stored brief with an ungrounded reference is a defect.
- **Determinism of grounding.** The grounding filter is deterministic (string
  membership against the input set); it involves no model call.
- **Observability.** `signals_used` recorded per brief (which inputs were
  present), never logged with secrets or diff line content — matching the
  Intent Layer's logging rule.
- **Accessibility.** `review_focus` items are keyboard-focusable links; the
  `risk_level` is conveyed by text, not colour alone.
- **i18n.** All card copy via `next-intl` message keys (see Copy); no inline
  literals.

---

## Server (from `server/specs/README.md`)

### Routes

Following the **shipped PR Intent Layer split** (`routes.ts:458–478`) rather than
the raw ask's single `POST`. Reason: the ask itself calls for "a separate button
to trigger regeneration", which is exactly the cached-GET / forced-POST split
the Intent Layer already ships; a single generate-on-read `POST` has no clean
cached-read path for the card's initial render. **This is a deliberate deviation
from the raw ask's literal `POST /pulls/:id/brief`.**

- `GET /pulls/:id/brief` — returns the cached brief or `null` (never generated).
  No LLM call. Zod `params: IdParams`, `response: PrBrief | null`. Tenancy via
  `getContext` + `resolvePrAndRepo`.
- `POST /pulls/:id/brief/refresh` — forces a fresh generation, persists it,
  returns it. `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }`.
  `response: PrBrief`.

Both response schemas come from `@devdigest/shared` (Contract changes below).
Whether generation should also happen implicitly on first review (as Intent does)
is **OQ-5**.

### Schema changes

Reuse the existing **dead** `pr_brief` table (`schema/reviews.ts:70`), which is
currently `{ prId (PK), json (jsonb) }` and unread anywhere. Two adjustments,
via `pnpm db:generate` (never a hand-written migration):

- Add a nullable `head_sha text` column, mirroring `pr_intent.headSha`
  (`schema/reviews.ts:60`), to key the cache to a PR state and drive staleness
  (AC-3, AC-4). The `json` column stores the serialized `PrBrief`.
- No unique-per-SHA versioning table: like `pr_intent`, one row per PR,
  overwritten on regenerate; the stored `head_sha` records which state it
  reflects. (If history of briefs across SHAs is later wanted, that is a new
  table — out of scope, note in OQ.)

### Adapters needed

None new. Generation reuses existing ports through the DI container:
- `container.llm(provider).completeStructured(...)` — the structured LLM call.
- `resolveFeatureModel(container, workspaceId, <feature key>)` — model
  selection. A new feature-model key for the brief may be needed (mirrors
  `'review_intent'`); confirm in planning.
- `container.ticketFetcher.resolve(url)`, `container.github().getIssue(...)` —
  already used by `IntentClassifier` for issue/spec resolution.
- Diff via the existing `loadDiff` helper (`reviews/diff-loader.ts`), reduced to
  shape via `buildDiffShape` (`intent-signals.ts`).

The brief-generation service is a new `server/src/modules/<name>/` plugin (name
in planning; `IntentClassifier` is the direct architectural precedent — service
does the I/O, caches via a repository, callers choose cache-vs-force). It is not
added to `pulls/routes.ts`, which already has no service layer.

---

## Client (from `client/specs/README.md`)

### Route(s)

No new route. The card mounts inside the existing PR Overview tab:
`client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`,
rendered **above** the existing `panelGrid` (Intent + Blast two-column row), per
the mockup.

### Data

- `usePrBrief(prId)` — `GET /pulls/:id/brief`, `null` when never generated.
  Mirrors `usePrIntent` (`hooks/reviews.ts:234`).
- `useRefreshBrief(prId)` — `POST /pulls/:id/brief/refresh`, writes result into
  the query cache on success. Mirrors `useRefreshIntent` (`hooks/reviews.ts:243`).
- **For the mockup's score/verdict/findings-count/cost/tokens (confirmed:
  display, don't generate):** read from the existing `usePrReviews(prId)`
  (`hooks/reviews.ts:53`) — the latest `Review` already carries `verdict`,
  `score` (0–100), and `findings[]` (blockers = `CRITICAL`). The card composes
  the two hooks; no new endpoint is needed for those values.
- Types come from `@devdigest/shared` (`PrBrief`); do not redeclare.

### States

- **No brief yet** — empty state with a Generate control (AC-14). Distinct from
  loading.
- **Loading** — while `usePrBrief` is fetching, or while `useRefreshBrief` is
  pending.
- **Generated, complete** — `what`/`why`, `risk_level`, `risks[]`,
  clickable `review_focus[]`.
- **Generated, partial** — as above plus a signals-used / partial indicator
  (AC-13), distinct from complete.
- **Generated, empty review_focus** — "nothing rose to read-first", distinct
  from both no-brief and partial (EC-6).
- **Stale** — cached brief whose head SHA is behind the PR head; regenerate
  affordance shown (AC-4, EC-5).
- **Error** — generation failed (LLM/network); retry affordance, card does not
  disappear.

### Copy

New keys under `messages/<locale>/` (exact namespace in planning):
- brief card title, generate-button label, regenerate-button label
- empty-state text ("no brief yet"), partial-inputs indicator text
- stale indicator text, error/retry text
- "review focus" section label, risk-level labels for each enum value
- "N of M" truncation label (EC-8)

---

## Contract changes

`@devdigest/shared` **first**, then both vendored copies via
`scripts/check-contracts.sh --fix`.

### Naming — read this before choosing an identifier

There is already a `PrBrief` type in `contracts/brief.ts` with a **different,
heavier shape** `{ intent, blast, risks, history }`, composed from `Intent`, an
**old** `BlastRadius` shape (`changed_symbols`/`downstream`/`summary` — not the
current L04 `PrBlastMap`), `Risks`, and `PrHistory`. Grep confirms **nothing in
`server/src/modules` or `client/src` reads or writes it**, and the `pr_brief`
table it maps to is empty and unread. It is dead scaffolding from an earlier,
heavier "PR Brief" concept.

This is the same collision L04 hit (`BlastRadius` was taken, so L04 introduced
`PrBlastMap` in a new file). **Decision — repurpose, not rename:** redefine
`PrBrief` in `contracts/brief.ts` to the new shape below and reuse the `pr_brief`
table as the cache. Rationale: nothing depends on the old shape, so a rename
would only leave dead code on disk; the table is already exactly the cache this
feature needs. **Confirmed with the requester (2026-08-27): repurpose, no
objection raised.**

> The old `BlastRadius`, `Risks`, `PrHistory`, `SmartDiff` building blocks in
> `contracts/brief.ts` that nothing else imports become dead on repurpose. The
> planner decides whether to delete them or leave them; deleting an exported
> symbol is a breaking change to consider (`.claude/skills/semver-discipline`),
> though here there are no consumers. Flagged, not decided here.

### New `PrBrief` shape (repurposed `contracts/brief.ts`)

```ts
// PR-level risk scale — distinct from Verdict (an action: request_changes/
// approve/comment) and Severity (per-finding: CRITICAL/WARNING/SUGGESTION).
// Matches the RiskSeverity precedent the dead brief.ts already used.
RiskLevel = z.enum(['high', 'medium', 'low'])

BriefRisk = {
  title: string,
  explanation: string,
  /** file paths / endpoint labels this risk points at — MUST be a subset of
   *  the generation input set (grounding, AC-7). */
  refs: string[],
}

BriefFocusItem = {
  /** file path (and optional line) or endpoint label — MUST appear in the
   *  input set (grounding, AC-7). Drives the clickable file:line link. */
  ref: string,
  line: number | null,
  description: string,
}

PrBrief = {
  what: string,
  why: string,
  risk_level: RiskLevel,
  risks: BriefRisk[],
  review_focus: BriefFocusItem[],
  /** Which inputs were actually present at generation (intent, blast, issue,
   *  specs, diff_shape) — drives the partial indicator (AC-13). */
  signals_used: string[],
  /** Head SHA the brief was generated against — cache key + file:line pin +
   *  staleness (AC-3, AC-4, AC-9). Nullish for rows written before this field. */
  head_sha: string | null,
}
```

Exact field naming (`refs` vs `file_refs`, `ref`+`line` vs a single string) is a
detail for planning; the shapes above are the contract's intent. `risk_level`
values and the grounding requirement (`refs`/`ref` ⊆ input set) are load-bearing
and are what the acceptance criteria are written against.

---

## Inputs and provenance

The Brief LLM call is assembled from these inputs; provenance determines which
are untrusted (next section):

| Input | Source | Controlled by | Pinned to |
|---|---|---|---|
| Intent (`what`/scope signals) | cached `pr_intent` (L03), via `container` | derived from PR author's text + repo | `Intent.head_sha` |
| Blast summary | cached L04 `PrBlastMap`, condensed to a summary — **not** the raw map | derived from the repo-intel index | `PrBlastMap.indexedSha` |
| Diff **stats/shape** | `loadDiff` → `buildDiffShape` (paths, +/-, hunk headers) | PR author (paths/counts), derived shape | PR `head_sha` |
| Linked issue | `extractIssueRefs` → `github().getIssue` | issue author (may differ from PR author) | fetched at generation time |
| Relevant specs | `extractSpecPaths` → clone read (`MAX_SPEC_CHARS`) | repo authors | clone at generation time |
| Model / provider | `resolveFeatureModel(...)` | server config | — |

The generated brief is pinned to the PR's `head_sha` at generation time; that
SHA is what `file:line` links resolve against (AC-9) and what staleness compares
(AC-4).

The **Blast summary is a condensed/derived view of `PrBlastMap`**, not the raw
map. What "summary" contains (top symbols? impacted endpoints? counts?) is a
generation detail; whatever it is, the file paths and endpoint labels it exposes
become part of the grounding set (EC-1).

## Untrusted inputs

Per `.claude/skills/security/SKILL.md` (A05 injection / Agentic-AI ASI01 goal
hijacking, A06 rate limiting) and this repo's established Intent-Layer posture:

- **PR title, PR body, linked-issue title/body, resolved-spec content** are
  **author-controlled data, never instructions.** They must be passed inside
  `wrapUntrusted('<label>', content)` blocks and the system prompt must instruct
  the model to ignore any instruction, role change, or request inside them, in
  any language — exactly as `intent-signals.ts` `SYSTEM_PROMPT` and
  `buildClassificationPrompt` already do (AC-15). Reuse that wrapper; do not
  hand-roll a new one.
- **Diff line content is never sent** (AC-8). Only paths, counts, and hunk
  headers. This is both a cost/privacy discipline and a prompt-injection surface
  reduction (a malicious diff comment cannot reach the model).
- **The regenerate route is an AI-generation endpoint** → rate-limited
  (AC-5), per the security skill's AI-generation limit.
- **Spec-path resolution must stay inside the clone** — the Intent Layer's
  `readClonedSpec` already rejects paths that escape the clone root
  (path-traversal guard, `intent-classifier.ts:169`). Reuse it; a new reader
  must keep the same guard.
- **Grounding is a safety control, not just UX** (AC-7): it prevents the model
  from surfacing a fabricated `file:line` the reviewer would click. Enforced
  server-side before persist, deterministically.
- **Tenancy:** both routes resolve the PR under the caller's workspace
  (`getContext` + `resolvePrAndRepo`), so a caller cannot read or regenerate a
  brief for a PR outside their workspace (A01 access control / IDOR).

## Open questions

Four of the original eight were resolved with the requester on 2026-08-27 (see
inline "Confirmed with the requester" notes above): score/verdict/cost/tokens
are displayed from the existing `Review`, not generated (Non-goals);
`review_focus[]` and `risks[]` are independent lists (EC-9); the dead
`PrBrief`/`pr_brief` are repurposed, not replaced (Naming); the screenshot
transcription is accepted as the design source of record (top of document).
Two more (OQ-3, OQ-4) were resolved during implementation, below. Remaining,
still open: OQ-5, and OQ-7 (now implemented, but the "is this the right level
of detail" question behind it is unresolved).

- **OQ-3 — Caps on `risks[]` / `review_focus[]` rendering — RESOLVED
  (implementation).** No server-side cap on either list (matches the
  provisional plan). Client-side, `review_focus[]` renders up to
  `REVIEW_FOCUS_DISPLAY_CAP = 5` items with a visible "N of M" expand
  affordance past that; `risks[]` renders in full, uncapped. See
  `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.tsx:19-21,113-134`.
- **OQ-4 — Overflow handling for long `what`/`why`/descriptions — RESOLVED
  (implementation).** Clamp-with-expand, not wrap-only or hard truncate: any
  `what`/`why` paragraph longer than `WHAT_WHY_CLAMP_CHARS = 220` characters is
  clamped with a trailing ellipsis and a "Show more"/"Show less" toggle,
  matching EC-7's "never clip silently" requirement. See
  `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.tsx:16,35-49`.
- **OQ-5 — Implicit generation on first review.** The Intent Layer classifies on
  the first review request as well as on manual refresh. Should the brief also be
  generated implicitly (e.g. after a review completes, when its inputs are
  freshest), or only ever on the explicit generate/regenerate control? Affects
  whether AC-1's "never generated" state is common or rare. **Still open —
  deliberately not implemented:** the shipped brief only ever generates via the
  explicit Generate/Regenerate control (`POST /pulls/:id/brief/refresh`); there
  is no implicit-on-review trigger.
- **OQ-7 — Blast summary shape — implemented, sizing question still open.**
  What the condensed "blast summary" input contains is no longer undecided in
  the sense of "unbuilt": `buildBlastSummary` in
  `server/src/modules/pr-brief/pr-brief-signals.ts` reduces a `PrBlastMap` to
  top symbols (name + file, capped at `MAX_REFS_PER_KIND`), impacted endpoint
  and cron/job labels (same cap), and the map's `counts` — never the raw
  caller lists or full symbol list. What remains open is whether this is the
  *right* level of detail (too little context vs. too much prompt weight) —
  a judgment call for real briefs on screen, not an implementation gap.
