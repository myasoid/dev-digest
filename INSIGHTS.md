# Insights — cross-package

Decisions that span more than one package, and things we tried that did not
work. Module-local lessons go in `<module>/INSIGHTS.md` instead.

Read at the start of a task, written at the end of one, by the
`engineering-insights` skill. Sections are fixed — add to the one that fits,
newest first. Every entry must be actionable cold: claim first, `path:line` or a
runnable command last. If it would be obvious to anyone reading the code, leave
it out.

Roughly 5 entries per section. When an entry becomes stable reference material,
move it into `docs/` and delete it here.

---

## Decisions

### 2026-08-24 — Authoring agents load skills from their own, narrower table

**What:** `.claude/skills/README.md` now holds an "Authoring load vs review
load" table — authoring / change-impact / review-only / orchestrator-only — and
`implementation-planner`, `implementer` and `test-writer` assign and load only
from it. `pr-self-review/routing.md` stays canonical for **review**. Two rules
ride along: a skill is loaded at most once per session, and the planner orders
its Steps so steps sharing a skill set are contiguous so that holds.
**Why:** `routing.md` is built for fan-out — one subagent per (skill × zone),
each shown only its own slice (`routing.md` §4) — so twelve routed skills cost
twelve small contexts. An authoring agent is **one** context and the same table
drops all of them into it. Concretely: `routing.md:58` routes
`typescript-expert` (431 lines) to any `.ts`/`.tsx` in any zone, i.e. every step
of every plan, and one `client/` step pulled `frontend-ui-architecture` +
`next-best-practices` + `react-best-practices` + `typescript-expert` ≈ 1071
lines before a line of code was written. `security`, `semver-discipline` and
`deprecation-policy` are lenses over finished code for the same reason.
**Rejected:** one routing table for both loads. It reads as consistency, but
the two have opposite economics, and the review table is the one that has to
stay exhaustive — shrinking it to suit authoring would have cut gate coverage.

### 2026-08-24 — Verification is two waves, not one parallel fan-out

**What:** `.claude/agents/README.md` previously said `architecture-reviewer`,
`plan-verifier` and `test-writer` "can run in any order (or be skipped)". Now:
wave 1 is the two read-only reviewers in parallel, gaps go back to
`implementer`, and wave 2 is `test-writer` against code that is final.
**Why:** the claim conflated "independent inputs" with "independent ordering".
All three consume the Implementation Report, but the reviewers only *read* and
their findings send work back, while `test-writer` *writes files* against the
code as it stands. Run in parallel, every gap the verifier finds invalidates
tests already written — you pay for the suite twice, and the second pass is the
one where the plan has changed under it.
**Rejected:** gating `test-writer` behind the reviewers by convention only. The
ordering is now stated as a wave in the pipeline diagram, because "can be
skipped" and "can be reordered" had already been read as the same permission
once.

### 2026-08-14 — Local review zones are derived from CI `paths:`, not redefined

**What:** `pr-self-review` decides which skills see which files by reading the
`paths:` filters in `.github/workflows/*.yml` and treating each workflow's
filter as one "zone". `.claude/skills/pr-self-review/routing.md` holds only a
cached copy plus the zone→skill mapping, and the skill prefers the workflows
when the two disagree.
**Why:** the gate's only claim is "a local PASS means CI will be green". A
second, hand-maintained glob list makes that claim decay silently the first time
someone edits a workflow — and the cross-zone edges are exactly the ones nobody
remembers: `reviewer-core/**` activates the *server* zone (server aliases
`../reviewer-core/src` at typecheck), and `server/src/vendor/shared/**` activates
the *reviewer-core* zone. This is the same property the 2026-07-31 "Standalone
packages" entry calls load-bearing.
**Rejected:** a self-contained glob table in the skill. Simpler to read, but it
is a copy of a source of truth that changes without it.

### 2026-08-07 — CLAUDE.md → AGENTS.md via symlink, not the `@AGENTS.md` import

**What:** all five `CLAUDE.md` files (root, `client/`, `e2e/`, `reviewer-core/`,
`server/`) were moved to `AGENTS.md`, with `CLAUDE.md` kept as a same-directory
symlink (`ln -s AGENTS.md CLAUDE.md`) so Claude Code keeps working unchanged.
**Why:** explicit choice to keep one canonical file per directory, byte-identical
regardless of which name is opened; the repo is developed on Linux/macOS only, so
the symlink's Windows caveat doesn't apply here.
**Rejected:** Anthropic's documented preference — a real `CLAUDE.md` containing
only `@AGENTS.md` (Claude Code's file-import syntax, memory.md docs) — because it
is cross-platform and survives copy steps that drop symlinks (Docker `COPY`, zip
export), which a plain symlink does not. Claude Code reads `CLAUDE.md` only; it
does not read `AGENTS.md` on its own. If this repo ever needs a Windows
contributor or a symlink-unsafe build/copy step, swap to the import stub — it is
a five-file, one-line-each change.

### 2026-07-31 — Standalone packages instead of a workspace

**What:** standalone packages, each with its own `package.json` and lockfile;
sharing happens through tsconfig path aliases, not published modules. Each suite
is gated by its own CI workflow with a path filter.
**Corrected 2026-08-24:** written as "four packages"; there are now **five** —
`mcp-server/` was added with `mcp-server.yml`. Do not re-count in prose; the
list of suites lives in `TESTING.md` and the zone list in `routing.md` §1.
**Why:** _rationale not recorded anywhere in the repo — fill this in._ Do not
"fix" this into a workspace before that gap is closed; it is load-bearing for the
per-package CI path filters.

### 2026-07-31 — Zod contracts as the single source of truth

**What:** `@devdigest/shared` schemas drive request validation, response
serialization, and client-side types.
**Why:** one definition, no drift between server and client.
**Rejected:** hand-rolled `Schema.parse(req.body)` inside handlers — it validated
input but left responses unchecked, so contract drift surfaced in the browser.

## What Works

- **2026-08-29** — A "does not fabricate a violation" negative-control case (a
  clean, no-violation fixture fed to the same prompt) is worth writing for
  **any** skill/agent eval whose job is flagging severity-tiered findings, not
  just `architecture-reviewer` where the pattern started (`BENIGN_PROMPT` in
  `agents/architecture-reviewer/architecture-reviewer.cases.ts`). Added the
  same shape to `evals/skills/dependency-checker/dependency-checker.cases.ts`
  ("does not fabricate a P0/P1 finding … (negative control)") — without it, an
  eval only proves the artifact *can* find a real problem, never that it
  stays quiet when there isn't one, which is the failure mode that erodes
  trust in a severity-tiered report the fastest.

- **2026-08-14** — A/B-ing a prompt change against a real model needs **repeats,
  and the right metric** — a single pair of runs is noise, not evidence. Building
  the skills control experiment, the first version ran each condition once and
  reported "0 findings without skills"; the very next invocation of the identical
  input reported 1 WARNING that already spotted the thing the skill was supposed
  to add. What is stable across repeats is **severity and verdict**, not finding
  count or wording — and since only `CRITICAL` trips the merge gate, that is also
  the only difference that changes anything operationally. Report it as a
  fraction: "blocks in 0/5 runs without skills, 5/5 with". Two more things that
  bit: the two conditions must run against the **same** PR row, or repo-intel
  enrichment silently differs between them and the comparison is confounded; and
  `tokensIn` roughly doubles on a structured-output reprompt, so it is not a
  proxy for prompt size — use the per-section breakdown for that.
  `cd server && pnpm experiment:skills --runs 5`

- **2026-08-14** — A "you may not proceed until you have run X" gate has to bind
  its verdict to **both** `git rev-parse HEAD` **and** a hash of the working
  tree; the sha alone lets a PASS earned on one set of changes be spent on
  another, since the uncommitted half is what usually changed. Two constraints
  on that hash, both found by testing rather than by reading: it must cover the
  *contents* of untracked files (a new file with `git status` alone hashes the
  name only, so editing it keeps a stale PASS valid), and it must exclude the
  gate's own artifacts — `.claude/pr-review/` is gitignored precisely so that
  writing a verdict does not invalidate the verdict just written, which is an
  unbreakable staleness loop. Compute it in exactly one place and have both
  writer and reader call it: `./scripts/pr-gate.sh --worktree-hash`.

## What Doesn't Work

- **2026-08-29** — `citation_accuracy` (the share of findings that survive the
  grounding gate) **cannot be recomputed from the database.** `groundFindings`
  runs *inside* `reviewPullRequest`, only survivors are ever written to
  `findings`, and `ReviewOutcome.dropped[]` dies with the call — the one
  persisted trace is `agent_runs.grounding`, a **text** column holding
  `"14/16 passed"`. Read the counts off `ReviewOutcome` at run time and store
  them as integers; regex-ing that display string back into a metric is the
  tempting wrong fix. Second trap in the same number: `FULL_FILE_KINDS`
  (`secret_leak`, `lethal_trifecta`, `phantom`, `hook`) skip the
  line-intersection check and only need the file to be present, so an agent
  emitting mostly those scores near 100% almost regardless of prompt quality —
  which reads as "citations are accurate" when it means "the gate had little to
  check". Disclose the exemption wherever the number is shown.
  `reviewer-core/src/grounding.ts:16`, `reviewer-core/src/grounding.ts:52`

## Codebase Patterns

- **2026-08-14** — Before building a lesson's feature, **inventory what the
  starter already wired**, because it is far more than the schema. `server/AGENTS.md`
  only warns that the DB has every table; in fact the Skills lesson also found
  its Zod contracts (`Skill`, `SkillType`, `SkillSource`, `AgentSkillLink` in
  `contracts/knowledge.ts`), the whole agent side of the relationship
  (`GET`/`POST /agents/:id/skills`, `setSkills`, `linkSkill`, plus skill ids
  already snapshotted into `agent_versions.config_json`), the engine slot and its
  rendering (`assemblePrompt`'s `skills` param → `## Skills / rules`), the trace
  field, the sidebar key in `activeKeyFor`, and **every user-facing string**
  pre-written in `client/messages/en/skills.json` — down to the import drawer's
  three tabs and the version label. The actual gap was one un-passed argument:
  `run-executor.ts` never handed `skills` to `reviewPullRequest` and wrote
  `skills: null` into every trace, so the feature was fully stored, fully
  versioned and completely inert. Read the i18n file first — it is the closest
  thing to a spec for the intended UI, and it settled two design questions
  (attachment *is* per-agent enablement; import is preview-then-confirm) that the
  written requirements left ambiguous. `client/messages/en/skills.json`,
  `specs/01-skills.md`
  **Recurred 2026-08-14 (Conventions):** same shape, different lesson. The
  `conventions` DB table, `ConventionCandidate` contract,
  `container.repoIntel.getConventionSamples()`, the `SkillType`/`FeatureModelId`
  enum members, and the full `client/messages/en/conventions.json` page copy
  all pre-existed; the gap was routes/service/repository/extraction-pipeline —
  and "turn accepted candidates into a skill" reuses the EXISTING skill-create
  + agent-skill-link routes rather than building new ones. One inherited
  wrinkle this time: `FEATURE_MODELS`'s `conventions` entry defaulted to
  `openai/gpt-5.4`, not a cheap model — the starter's registry default was
  actively wrong for what the feature needs, not just incomplete; check
  registry *defaults*, not only presence, when inventorying. `specs/03-conventions.md`,
  `server/src/modules/conventions/`
  **Recurred 2026-08-18 (Intent Layer):** same shape again, and the scaffolding
  this time gave away the wiring point, not just the schema.
  `pr_intent`/`upsertIntent`/`getIntent`, the `Intent` contract, and
  `FEATURE_MODELS`'s `review_intent` entry all pre-existed (with the same
  "actively wrong default" wrinkle — `openai/gpt-4.1`, not a flash-tier model).
  But `server/src/platform/run-logger.ts`'s class docstring already listed
  "load diff, derive intent, embed + retrieve memory, load skills/specs, each
  model call, grounding, persistence" as the run's steps — before any intent
  classifier existed — which is a direct pointer to WHERE the new pre-work
  belongs (fanned out over every queued run's `RunLogger`, before the
  per-agent loop, exactly like the existing diff load) that would otherwise
  have to be reverse-engineered from the run-executor's control flow.
  `server/src/platform/run-logger.ts:14`, `server/src/modules/reviews/
  run-executor.ts` (`loadOrClassifyIntent`)
  **Recurred 2026-08-25 (Project Context), caught at SPEC time:** so generalise
  this entry's "read the i18n file first" to **grep the feature's name across
  `server/src/vendor/shared/contracts/*.ts` AND `client/messages/en/*.json`
  before scoping anything** — contracts give the data model and the trace
  fields, i18n gives the intended UI, and two greps cost a minute. Here they
  returned `PromptSection`'s `'specs'` member, `PromptAssembly.specs`,
  `RunTrace.specs_read`, a whole `// ---- Project Context ----` block declaring
  `SpecFile` and `IndexStatus`, the entire page's copy including its empty
  state, the nav label, and two written-but-uncallable hooks commented "A3
  contract; safe to call once API exposes it" — for an endpoint that does not
  exist. `reviewer-core` needed **zero** changes: `assemblePrompt` already wraps
  each entry as `<untrusted source="spec-N">` and renders `## Project context`.
  The dead wire was again one unpassed argument — `run-executor.ts` writes
  `specs_read: []` and `specs: null` into every trace and never resolves the
  slot. Doing the greps first re-sized the feature from "build a prompt block"
  to "discovery + attachment + one argument + three UI surfaces", which is a
  scoping difference, not a detail — and at spec time it is still free to act
  on. `server/src/vendor/shared/contracts/platform.ts:262`,
  `server/src/modules/reviews/run-executor.ts:386`, `specs/2026-08-25-project-context.md`
  **Recurred 2026-08-29 (Eval Pipeline):** same inventory, plus a new twist —
  the pre-wired pieces can **disagree with each other**, so check they are
  mutually consistent before designing to either one. `eval_cases`/`eval_runs`
  (`server/src/db/schema/eval.ts:7`), the `EvalRun`/`EvalCase` contracts and a
  whole `contracts/eval-ci.ts` API layer all pre-exist — but `EvalRun`
  (`knowledge.ts:58`) is **set**-shaped (`traces_passed`, `traces_total`,
  `per_trace[]`) while the `eval_runs` **table** is **case**-shaped (`case_id`
  FK, no `agent_id`, no version, no grouping id), and `EvalRunResult`
  (`eval-ci.ts:49`) then pairs a single `case_id` with the set-shaped metrics.
  So no row can mean "this agent, at v7, over all 20 cases", and run history,
  the metric trend and any version-vs-version compare are unbuildable on the
  shipped schema without a new table. Related naming hazard: the repo now holds
  three unrelated things called "eval" — root `evals/` (a separate pnpm package
  of offline Claude Code harness evals, not this feature and never imported by
  it), the `EvalRun` contract, and these tables. `specs/2026-08-29-eval-pipeline.md`
  **Sharpened at PLAN time, same day:** a spec that catalogues these
  disagreements can still miss one a field deeper, so re-grep the contracts for
  the *shape* the spec's rules require, not just the types it names. The spec
  mandates "empty denominators return `null`, never `0`" and lists
  `EvalDashboard.recent_runs`' element-type change — but `EvalTrendPoint`
  (`eval-ci.ts:57`) and `EvalDashboard.current` (`:72`) still declare
  `recall`/`precision`/`citation_accuracy` as **non-nullable** `z.number()`. A
  set of only negative controls has no `must_find` targets, so it would either
  fail response serialization or coerce to `0` — and `0` reads as total failure
  in the exact case where the agent did everything right, which is worse than
  crashing. Widen both before the first metric renders.
  `server/src/vendor/shared/contracts/eval-ci.ts:57`

- **2026-08-04** — `server/src/vendor/shared/contracts/*.ts` and
  `client/src/vendor/shared/contracts/*.ts` are two independent files with no
  sync script between them — a schema change must be hand-edited in both
  (server first, per `AGENTS.md`). Confirmed by a pre-existing comment-only
  diff between the two `trace.ts` copies before this session touched either.
  Forgetting the client copy compiles fine locally (client typecheck only sees
  its own copy) and fails invisibly until the two drift on a real field.
  **This is exactly what happened. Gated 2026-08-14.** By then 5 files had
  drifted on real fields, not comments: the client copy of `adapters.ts` was a
  generation behind (no `CommitFile`, `CommitFilesPayload`, `commitFiles()`,
  `findOpenPr()`, `sessionId`), and `'openrouter'` was missing from the provider
  enum in `adapters.ts`, `eval-ci.ts` and `productionize.ts` — so a provider the
  server supported could not be typed on the client at all. Both packages
  typechecked green throughout. `scripts/check-contracts.sh` now diffs the two
  trees and is a required job in both `client.yml` and `server-unit.yml`; run it
  with `--fix` to adopt the server side (server is canonical), then
  `cd client && pnpm typecheck` because new fields widen unions.
  `scripts/check-contracts.sh`

- **2026-08-01, corrected 2026-08-14** — Per-run LLM cost is computed end-to-end
  **and persisted**. Every provider returns `costUsd` on its result, and for
  OpenRouter it is the REAL billed figure — the client asks for it with
  `usage: { include: true }` and reads `usage.cost`, falling back to the injected
  `PriceBook` estimator. `reviewPullRequest` sums it across map-reduce chunks
  onto `ReviewOutcome.costUsd`.
  **The "never persisted" half of this entry is no longer true.** Commit
  `d45ab0d` did drop the field at the `run-executor.ts` destructure and delete
  the column (migration `0009_complex_runaways.sql`), but `0010_modern_professor_
  monster.sql` re-added `agent_runs.cost_usd` and back-filled it, and the write
  path is live again — `run-executor.ts:213` destructures it, `:249` passes it to
  `completeAgentRun`, `run.repo.ts:179` writes it. So surfacing cost costs zero
  extra model calls **and** zero schema work: read the existing column.
  One caveat the backfill introduces — rows predating `0010` hold an *estimate*
  computed from a hardcoded price list in the migration, not a billed figure,
  and models absent from that list are `NULL`. Live rows are real. Don't present
  historical and new costs as the same kind of number.
  `reviewer-core/src/review/run.ts:216`, `server/src/db/migrations/0010_modern_professor_monster.sql:13`

## Tool & Library Notes

- **2026-08-29** — A judge-scored eval case that asserts a specific graph edge
  or relationship must appear needs an **unambiguous** synthetic fixture, or
  the judge's pass rate looks like model flakiness when it's actually fixture
  ambiguity. `evals/skills/dependency-checker/dependency-checker.cases.ts`'s
  fixture said `client imports "@shared/review-types" (same alias as server)`
  — the model legitimately read this two ways across repeated runs: a real
  client→server edge, or an intra-package alias to client's own local copy.
  Both readings are defensible from the sentence alone, so the eval flapped
  between pass/fail on identical prompts. Fixed by making the fixture state
  the actual convention explicitly (per this file's own **2026-08-04** entry:
  server/client vendor *independent, unsynced* copies of shared contracts, so
  that import does not cross the package boundary at all). When a quality eval
  case hinges on "does X count as edge/violation/dependency Y", read the
  fixture line back as a judge would and check it can only be read one way.

- **2026-08-29** — A SKILL.md `description:` frontmatter field must be quoted if
  its text contains a colon followed by a space (e.g. `Trigger terms: "x", "y"`).
  As a plain (unquoted) YAML scalar, a mid-string `: ` is parsed as a nested
  mapping key, and gray-matter/js-yaml throws rather than warns — this crashed
  `evals/src/skill-quality.ts` on `.claude/skills/onion-architecture/SKILL.md`
  with no per-file isolation, halting the whole static gate. Not just an eval
  quirk: any tool parsing SKILL.md frontmatter as YAML hits the same throw.
  Fixed by quoting the description, matching the convention already used by
  `fastify-best-practices`, `mermaid-diagram`, `security`, etc. When adding a
  new SKILL.md, quote `description:` if it contains `: ` anywhere in the text.

- **2026-08-29** — pnpm ≥10 no longer reads `pnpm.onlyBuiltDependencies` from a
  package's `package.json` (the field is silently ignored with a warning); it
  must live in `pnpm-workspace.yaml` as top-level `onlyBuiltDependencies: [...]`.
  Even with that fixed, `pnpm install` still leaves dependency postinstall
  scripts (e.g. esbuild, pulled in transitively via `tsx`/`vitest`) un-run and
  prints `[ERR_PNPM_IGNORED_BUILDS]` on every install until you explicitly run
  `pnpm approve-builds --all` once (writes an `allowBuilds:` block back into
  `pnpm-workspace.yaml`). Hit standing up `evals/` fresh — a first-time
  `pnpm install` there looks like it succeeded but silently skips esbuild's
  native-binary postinstall. `evals/pnpm-workspace.yaml`

- **2026-08-14** — A `PreToolUse` hook on `Bash` sees only the command *string*,
  and both consequences bite immediately. (1) A substring match fires on any
  command that merely mentions the guarded text — `scripts/pr-gate.sh`'s first
  smoke test blocked itself, because the test echoed `gh pr create` as JSON into
  the hook. Anchor to a command position instead: start of line or after
  `;`/`&&`/`||`/`|`/`(`, allowing `VAR=value` prefixes. (2) An inline env prefix
  does **not** reach the hook — `PR_SELF_REVIEW_SKIP=1 gh pr create` sets the
  variable for that command only, while the hook runs as a separate process that
  never sees it, so an env-var escape hatch that is only read via
  `$PR_SELF_REVIEW_SKIP` is silently dead. Detect the prefix in the command text
  as well. Also make parse failures **allow**: a hook that blocks every `Bash`
  call because its stdin was malformed is far worse than one that misses a PR.
  `scripts/pr-gate.sh:36`

- **2026-08-07** — The numeric rules in the `react-best-practices` skill — "Max
  200 lines per component", "Max 5-7 props" — have **no authoritative source**.
  A two-round research pass over react.dev, nextjs.org, Kent C. Dodds, Robin
  Wieruch and bulletproof-react found zero primary sources stating any numeric
  component-size threshold; React's only stated criterion is behavioural ("a
  component should ideally only be concerned with one thing", `Thinking in
  React`). The one numeric rule that *is* sourced governs duplication, not file
  length: abstract on the third occurrence ("two times, but never three", Dodds,
  *AHA Programming*). So treat the line/prop counts as house style — usable as a
  smell trigger, not quotable as industry practice, and not a review comment on
  their own. `.claude/skills/frontend-ui-architecture/README.md` records the
  full evidence and tags every rule `[DOC]` / `[CONV]` / `[SPLIT]` for exactly
  this reason.

- **2026-08-07** — The `deep-research` workflow answers "what does the canonical
  doc say" well and "what do practitioners do" not at all. A 102-agent,
  3.5M-token run on frontend architecture returned 14 high-confidence findings
  clustered entirely on Feature-Sliced Design's docs plus Next.js/React
  first-party material, and **zero** verified claims for six requested
  sub-questions (component-extraction criteria, constants placement, the
  utils/helpers/lib taxonomy, business-logic placement, types/test colocation,
  state placement) — its adversarial verification kills named-author blog claims
  that no primary source corroborates, which is most practitioner knowledge. Its
  own `caveats` field says so; read that field before the findings. The fix is
  cheap: a targeted pass of ~8 direct `WebFetch` calls against named URLs filled
  all six gaps in a fraction of the cost. Use the workflow to map a field, then
  fetch the practitioner sources by hand.

## Recurring Errors & Fixes

- **2026-08-29** — `cd evals && pnpm eval:workflow` failing with `<path> not
  read` for `server/docs/api-contracts.md`, `reviewer-core/docs/pipeline.md`,
  or `reviewer-core/insights/gotchas.md` means those specific files don't
  exist yet, not a harness bug: `evals/workflow/review-workflow.cases.ts`
  asserts on doc paths that the "Read when" rows in `AGENTS.md` promise but
  that were never written. The model correctly falls back to whatever
  adjacent docs (`README.md`, `INSIGHTS.md`) actually exist. Fix is to write
  the missing doc(s) and add the matching "Read when" row, not to loosen the
  case. Once a routed doc exists, a tight `maxTurns` on that case (e.g. 5) can
  still flake because the model now has more real docs to explore before
  reaching the right one — give it the same room as sibling routing cases
  (8 turns) rather than the bare minimum.
- **2026-08-24** — **A new package silently escapes the lockfile gate**, because
  `conventions.md` A2.3 enumerates paths instead of deriving them. `mcp-server/`
  is an npm package (root `AGENTS.md`, "Conventions") yet carries **both**
  `mcp-server/package-lock.json` **and** `mcp-server/pnpm-lock.yaml`, the second
  committed in `62520fa` and neither gitignored — i.e. pnpm was run in an npm
  package, which A2.3 calls CRITICAL. It never fired: that rule's table lists
  only `reviewer-core/pnpm-lock.yaml` and `e2e/pnpm-lock.yaml`, and
  `mcp-server/` did not exist when it was written. The same staleness hit
  `TESTING.md`, which still said "four independent packages" and omitted
  `mcp-server` from its suite map, and the `implementer`/`test-writer` prompts,
  which had no test command for it at all. When adding a package, grep the
  gate's own rule tables for a sibling package name — presence in
  `routing.md` §1 is not enough, A2.3 is a separate hardcoded list.
  `git ls-files '*/pnpm-lock.yaml' '*/package-lock.json'` shows the whole
  picture in one line. `.claude/skills/pr-self-review/conventions.md` (A2.3)
  **Recurred the same day, A3:** adding the `run-plan` skill directory would
  have tripped the router self-audit ("a skill exists but has no row in
  `routing.md` → WARNING"), whose exemption list also enumerated names —
  `pr-self-review`, `mermaid-diagram`, `engineering-insights`. Fixed by
  restating A3's exemption **by kind** ("authors or orchestrates rather than
  reviews") so the list is illustrative, not the rule. Both rules were written
  when their lists happened to be complete; neither had a way to notice it had
  stopped being true. When adding a skill or a package, grep
  `conventions.md` + `routing.md` for a sibling's name before assuming you are
  covered.

## Open Questions

_None yet._
