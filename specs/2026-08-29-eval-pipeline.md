# Eval Pipeline — a regression harness for reviewer agents

**Status:** draft
**Packages touched:** server, client (`reviewer-core` unchanged — it is called, not modified)
**Follows:** L01–L05 accept/dismiss decisions (the dataset), `agent_versions` (the labels)

## Problem

Every knob on a reviewer agent — the system prompt, the model, the linked
skills — is edited blind. Change one, run a review, read three findings, form an
impression. The impression is the only feedback loop, and it is worthless: a
single pair of runs against a real model is noise, not evidence
(`INSIGHTS.md`, *What Works*, 2026-08-14).

So the question "did that edit make the agent better or break it?" has no answer
today. The Eval Pipeline gives it one in numbers: change a knob → run the set →
read **recall / precision / citation_accuracy** against the previous run.

**The dataset already exists and nobody has to invent it.** Every finding a user
accepted is a labelled positive — *this agent should find this, here*. Every
finding they dismissed is a labelled negative — *this agent should stay quiet
about this, here*. `findings.accepted_at` and `findings.dismissed_at` are full of
these. The whole "Turn into eval case" button does is move a row that already
carries a human judgement into a set that gets replayed.

**No model scores anything.** Scoring is file-and-line-overlap arithmetic in
plain TypeScript. A model-judged eval would put the thing under test on both
sides of the test.

## Naming — three unrelated things are called "eval". Read this before choosing an identifier

This is the single easiest way to write the wrong code in the wrong package.

| Name | What it is | Where |
| --- | --- | --- |
| `evals/` (repo root) | **A different product.** Offline vitest + Claude Agent SDK evals for the *Claude Code harness* — `.claude/skills/*`, `.claude/agents/*`, `CLAUDE.md`. Its own pnpm package, its own lockfile, writes `results/records.jsonl`. No database, no Fastify, no browser. | `evals/README.md` |
| `EvalRun` | A Zod **metrics** shape, already shipped. Set-shaped: it carries `traces_passed` / `traces_total` / `per_trace[]`. | `contracts/knowledge.ts:58` |
| `eval_runs` | A Postgres **table**, already shipped. Case-shaped: one row per case, FK `case_id`, no agent, no version. | `db/schema/eval.ts:22` |

The last two share a name and disagree about what "a run" is. That disagreement
is gap 1 below — it is not cosmetic, and it is why the dashboard in the mockup
cannot be built against the current schema.

This feature is **in-app**: Postgres, Fastify, Next.js. It does not touch
`evals/` and must not import from it. When both need naming in one sentence:
*harness evals* (`evals/`) vs *agent evals* (this).

## What already exists

Most of the scaffolding is in the starter. Stating it so nobody rebuilds it —
and so the gaps below read as the small list they actually are.

- **Both tables.** `eval_cases` and `eval_runs` ship in `0000_init.sql` and are
  defined at `server/src/db/schema/eval.ts:7` and `:22`. They have never been
  written to. Per `server/CLAUDE.md`, an empty table here is expected, not a bug.
- **The metric contracts.** `EvalRun`, `EvalPerTrace`, `EvalCase`,
  `EvalOwnerKind` in `contracts/knowledge.ts:50-84`; `EvalCaseInput`,
  `EvalRunRecord`, `EvalRunResult`, `EvalTrendPoint`, `EvalDashboard` in
  `contracts/eval-ci.ts:19-89`. Both vendored copies are in place and the barrel
  already re-exports them (`vendor/shared/index.ts:29`).
- **Agent versioning.** `agents.version` plus the `agent_versions` table
  (`db/schema/agents.ts:38`), holding an immutable `config_json` snapshot —
  provider, model, `system_prompt`, `output_schema`, strategy, `ci_fail_on`,
  `repo_intel`, and the ordered skill ids. A version bumps on any config change
  but not on an `enabled` toggle (`agents/repository.ts:122`). `GET
  /agents/:id/versions/:version` already serves it. **This is what makes "v6 vs
  v7" a real comparison rather than a label** — the compare view's prompt diff
  needs no new server work.
- **The engine entry point.** `reviewPullRequest(input): Promise<ReviewOutcome>`
  (`reviewer-core/src/review/run.ts:139`) takes a `UnifiedDiff` and an injected
  `LLMProvider` and returns grounded findings, `dropped[]` with reasons,
  `tokensIn/Out`, `costUsd`, and the prompt assembly. It has no idea what a PR
  is. Feeding it a stored diff instead of a live one requires nothing from it.
- **Diff text → `UnifiedDiff`.** `parseUnifiedDiff()`
  (`adapters/git/diff-parser.ts`), and `diffFromPrFiles()`
  (`reviews/diff-loader.ts:32`) shows exactly how to assemble the text from
  `pr_files.patch` — `diff --git` / `---` / `+++` / patch, joined. A case can
  store text and replay it.
- **The grounding gate.** `groundFindings(findings, diff)`
  (`reviewer-core/src/grounding.ts:52`) returns `{ kept, dropped }` where each
  drop carries a reason. `groundingSummary()` renders `"3/4 passed"`.
- **The background-run pattern.** `POST /pulls/:id/review` creates rows in
  `running`, returns immediately, executes in `ReviewRunExecutor`, streams over
  `GET /runs/:id/events` via `container.runBus`, and stale `running` rows are
  reaped on boot (`app.ts:89`). An eval run should look exactly like this.
- **Charts.** `Sparkline`, `LineChart` (recharts), `Donut`, `BarRow`,
  `MetricCard` — `client/src/vendor/ui/charts/index.ts`. The metric-trend chart
  in the mockup needs no new dependency.
- **The nav key.** `activeKeyFor()` already maps `pathname.startsWith("/eval")`
  → `"eval"` (`client/src/components/app-shell/helpers.ts:35`). The route is
  expected; only the page and the nav entry are missing.
- **A precedent for the experiment.** `pnpm experiment:skills --runs 5`
  (`server/scripts/skills-experiment.ts`) is the same A/B shape, already built
  and already burned once by n=1 reporting.

## What is actually missing or wrong

Seven gaps. Four are design faults in shipped schema and contracts, not just
absent code — and three of those (2, 5, 6) produce numbers that look right while
being wrong, which is the failure mode a metrics feature can least afford.

### 1. `eval_runs` cannot express a run of the set — and the contract disagrees with the table

`eval_runs` has `case_id` and per-case metrics. It has **no `agent_id`, no agent
version, and no grouping id**. So there is no row anywhere that means *"the
Security Reviewer, at v7, over all 20 cases"*.

Every set-level thing the feature is for is therefore unrepresentable:

- the mockup's RECENT RUNS table (`ran_at · v7 · 82% · 91% · 95% · 17/20 · $0.23`)
- `EvalDashboard.current.traces_passed / traces_total` — 17 of what?
- comparing v6 against v7, which needs each run to know its version
- the metric trend line, which is one point per set run

Meanwhile `EvalRun` (`knowledge.ts:58`) is already **set**-shaped — it carries
`traces_passed`, `traces_total` and `per_trace[]` — and `EvalRunResult`
(`eval-ci.ts:49`) then pairs it with a single `case_id`, producing a set-shaped
metrics object describing one case with a `per_trace` array of length 1. That is
the two definitions of "run" colliding in one type.

Fix: a new `eval_suite_runs` table for the set-level run, with
`eval_runs.suite_run_id` pointing at it. `eval_runs` keeps its meaning — one
case, one execution — and stops pretending to be the unit the UI displays.

### 2. `must_find` vs `must_not_flag` is unrepresentable — and belongs on the target, not the case

`eval_cases.expected_output` is a bare `jsonb`, and `EvalCase.expected_output` is
`z.unknown()`. There is no expectation kind anywhere.

The mockup papers over this by encoding *"must not flag"* as an empty expected
array — the `clean-refactor-no-flags` case badged `empty []`. That works for a
whole-diff negative control and **fails for the case this feature is actually
built on**: a dismissed finding is *"do not flag **this**, at `file:line`"*,
while other findings on the same diff remain perfectly legitimate. An empty array
cannot say that.

The obvious repair — an `expectation_kind` column on the case — is also wrong,
just less visibly. It makes one case mean one expectation, and the most ordinary
real situation is a single PR where the user accepted one finding and dismissed
two. That is one diff carrying **both** kinds, and a per-case kind cannot hold
it. The kind is a property of the **target**; the case is the frozen input the
targets are asserted against.

What a per-case kind *would* still be needed for is the negative control — "flag
nothing anywhere in this diff", which names no target at all. That is a separate
question (what to do with findings matching no target) and gets its own field
rather than being smuggled into an empty array.

### 3. Nothing links a case back to the finding it was born from — or to the PR

No `source_finding_id`, no `source_pr_id`. Consequences: clicking "Turn into
eval case" twice creates two cases; the FindingCard cannot show that a case
already exists; and when a case starts failing there is no way back to the human
decision that justified it.

The missing PR link is the more expensive half, because of how expectations are
shaped (gap 2). Three findings on one PR — one accepted, two dismissed — become
three cases, each storing **the same whole-PR diff**. Every run then replays that
diff three times, and since scoring aggregates over targets, that single PR
carries triple weight. The cost and the weighting of the set end up determined by
how many buttons the user happened to click on one page.

A case is *one frozen diff*. Findings from the same PR belong to the same case as
additional targets.

### 4. `citation_accuracy` is not derivable from anything we persist

Defined as *the share of findings that survived the grounding gate* — but the
gate runs **inside** `reviewPullRequest`, and only survivors are ever written to
`findings`. The `dropped[]` array does not outlive the call. The one persisted
trace of it is `agent_runs.grounding`, a **text** column holding `"14/16
passed"`.

So this metric cannot be recomputed from the database after the fact, and it must
not be recovered by regex-parsing a display string. The eval executor has to read
the counts off `ReviewOutcome` at run time and store them as integers.

**And it needs a caveat in the UI, not just here.** `FULL_FILE_KINDS`
(`grounding.ts:16`) — `secret_leak`, `lethal_trifecta`, `phantom`, `hook` — are
exempt from the line-intersection check and only need the file to be present. A
security agent whose findings are mostly these kinds will score a
`citation_accuracy` near 100% almost regardless of prompt quality. Reported bare,
that number will be read as *"citations are accurate"* when it means *"the gate
had little to check"*.

### 5. Inputs are not frozen — and `agent_version` lies about it

Two separate leaks, and the second one is worse because it is silent *and*
mislabelled.

**Repo-intel is rebuilt per run.** `ReviewRunExecutor` derives callers digest,
repo map and rank note (`run-executor.ts:223`) whenever `agent.repo_intel` is
true, against the *current* index, which moves between runs. Two runs of v6 and
v7 that each rebuild it are not a controlled comparison; the prompt differs in a
second place nobody looked at. Already paid for once: *"the two conditions must
run against the same PR row, or repo-intel enrichment silently differs between
them and the comparison is confounded"* (`INSIGHTS.md`, *What Works*,
2026-08-14).

**A linked skill's body is not covered by the agent version.**
`agents.update()` bumps `version` only on a change to the agent's own columns
(`agents/repository.ts:133`), and `agent_versions.config_json.skills` stores
skill **ids**, not bodies. The body lives in `skills.body` and is edited through
the Skills UI, which touches no agent row.

So: edit a skill's text, re-run the set, and both runs are stamped `v7` while
their prompts differ. The version label — the one thing making "old prompt vs new
prompt" a real comparison rather than a caption — is wrong precisely in the
workflow this feature exists to support (*change the prompt, the model, **or the
linked skill** → run evals*).

The fix costs nothing, because the same versioning already exists one level down:
`skills.version` and a `skill_versions` table holding the body per version
(`db/schema/skills.ts:23`). A run must pin `(skill_id, skill_version)` pairs and
resolve bodies from `skill_versions`, never from the live `skills.body`.

Generalised: **comparability must be computed, not assumed.** A run has to record
everything that determined it — agent version, skill versions, and the case-set
revision (gap 6) — so that "are these two runs comparable?" is a field
comparison, not a matter of trusting that nobody touched anything in between.

### 6. Editing a case silently rewrites what the trend line means

A regression suite is only readable if consecutive points measure the same thing.
Nothing stops a user from editing a case's targets or its diff after five runs
exist — and when they do, the old points stay on the chart, still drawn as one
continuous line, now mixing two different tests. The line keeps looking
meaningful, which is the failure mode that matters: a broken chart gets
investigated, a quietly-wrong one gets believed.

Note that not every edit does this. Renaming a case or fixing its notes changes
nothing measurable. The distinction already has a precedent in this codebase —
`isConfigChange` bumps an agent's version for config edits and not for an
`enabled` toggle (`agents/repository.ts:122`) — and the same split applies here.

### 7. No routes, no service, no UI

No `eval` module under `server/src/modules/`. In the client, `TABS` for the agent
editor is `["config", "skills"]` (`AgentEditor/constants.ts:11`), `VALID_TABS` is
the same list (`agents/[id]/page.tsx:15`), `NAV` has no eval entry
(`vendor/ui/nav.ts:21`), and no `/eval` page exists. The Skills side has an
`EvalsTab` that renders an `EmptyState`.

## Scope — in / out

**In**

- `eval_suite_runs`, and the columns gaps 1–6 require on `eval_cases` /
  `eval_runs`.
- One-click case creation from a decided finding: target kind derived from the
  decision, findings from one PR folded into one case.
- `POST /agents/:id/eval-runs` — frozen-input replay of every case in the set,
  with agent version, skill versions and case-set revision recorded so
  comparability is a field check rather than an assumption.
- Code-only scoring: recall, precision, citation_accuracy, per-case pass.
- **Evals** tab in the agent editor: case list, run history, run detail.
- **Eval Dashboard** page: all agents, recent runs, per-agent trend, compare two
  runs side by side with the system-prompt diff.
- The prompt experiment, run for real, with repeats (see *The experiment*).

**Out**

- **A model-judged scorer.** The point is a check the agent cannot argue with.
- **Skill evals.** `eval_cases.owner_kind` already has `'skill'` and the Skills
  `EvalsTab` placeholder is waiting, so nothing may hard-code `'agent'` — but
  skills reach the model differently (unfenced prompt text, `prompt.ts:141`) and
  scoring them is a separate question. Build agent-shaped, stay skill-ready.
- **"Promote v7"** (the button in the compare mockup). There is no
  restore-a-version route today — only `GET /agents/:id/versions/:version`.
  Promotion is an agent-editor feature, not an eval feature.
- **CI-gating on eval results.** `ci_fail_on` gates reviews, not evals. Blocking
  a merge on a metric this young is how the metric gets gamed.
- **Cross-agent leaderboards.** Different agents run different case sets; the
  numbers are not comparable and a shared table implies they are. The dashboard
  lists agents; it does not rank them.

## Contract changes

`@devdigest/shared` first, then both vendored copies via
`scripts/check-contracts.sh --fix`.

New file `contracts/eval-run.ts`. Do **not** widen `knowledge.ts`'s `EvalRun` —
it is the per-execution *metrics* shape and stays that.

```ts
EvalExpectationKind = z.enum(['must_find', 'must_not_flag'])

/**
 * One assertion about one place in the case's diff. The KIND LIVES HERE, not on
 * the case — one frozen diff routinely carries both (gap 2).
 * Display fields are NEVER matched on.
 */
EvalTarget = z.object({
  kind: EvalExpectationKind,
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  /** The finding this target was minted from. Null once that finding is gone. */
  source_finding_id: z.string().nullable(),
  /** Display + provenance only — see Scoring. */
  severity: Severity.nullish(),
  category: FindingCategory.nullish(),
  title: z.string().nullish(),
})

/**
 * What to do with a grounded finding matching NO target.
 * 'ignore'  — default. An extra finding is not held against the agent.
 * 'forbid'  — every unmatched finding is a false positive. With zero targets
 *             this is the whole-diff negative control the mockup draws as
 *             `empty []`; with must_find targets it is strict mode.
 */
EvalUnlistedPolicy = z.enum(['ignore', 'forbid'])

EvalSuiteRunStatus = z.enum(['running', 'succeeded', 'failed', 'cancelled'])
/** 'case' = one-case debug run. Excluded from trends — see Scoring. */
EvalRunScope = z.enum(['suite', 'case'])

/** Everything that determined a run's output. Comparability is computed from
 *  this, not assumed — see gap 5. */
EvalRunInputs = z.object({
  /** agents.version at run start. The v6/v7 label. */
  agent_version: z.number().int(),
  /** The skill BODIES that ran, pinned by version. Not ids alone. */
  skill_versions: z.array(
    z.object({ skill_id: z.string(), version: z.number().int() }),
  ),
  /** Fingerprint over the set's (case_id, revision) pairs — see gap 6. */
  case_set_revision: z.string(),
})

EvalSuiteRun = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  inputs: EvalRunInputs,
  scope: EvalRunScope,
  status: EvalSuiteRunStatus,
  ran_at: z.string(),
  finished_at: z.string().nullable(),
  cases_total: z.number().int(),
  cases_passed: z.number().int(),
  /** null, never 0, when the denominator was empty — see Scoring. */
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  findings_kept: z.number().int(),
  findings_dropped: z.number().int(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  error: z.string().nullable(),
})
```

`EvalCase` gains `targets: EvalTarget[]`, `unlisted: EvalUnlistedPolicy`,
`source_pr_id: string | null`, `revision: number`, `created_at: string`. It gains
**no** case-level expectation kind and **no** case-level `source_finding_id` —
both moved onto the target.

`EvalRunRecord` gains `suite_run_id: string`, `findings_kept`,
`findings_dropped`, `case_revision: number` (which revision this row measured),
and `violations: EvalViolation[]`.

`EvalTarget[]` cannot carry violations: an unlisted-`forbid` violation has no
target to point at, and a target alone never says *which finding* tripped it. A
violation is finding-shaped, with an optional target:

```ts
EvalViolation = z.object({
  reason: z.enum(['must_not_flag', 'unlisted']),
  /** The offending finding — always present; this is the "what happened". */
  finding: Finding,
  /** The must_not_flag target it hit. Null when reason is 'unlisted'. */
  target: EvalTarget.nullable(),
})
```

Unmatched `must_find` targets are **not** violations — they are misses, reported
separately as `missed: EvalTarget[]`. Folding the two together would put a
false negative and a false positive in one list under one label, which is
precisely the distinction the whole scorer exists to draw.

`EvalDashboard.recent_runs` changes element type from `EvalRunRecord` (per case)
to `EvalSuiteRun` (per set). This is the contract half of gap 1; the current type
cannot populate the mockup's table.

### Schema

Edit `src/db/schema/eval.ts`, then `pnpm db:generate` → `pnpm db:migrate`. Never
hand-write the SQL (`server/CLAUDE.md`).

- **`eval_suite_runs`** (new) — every field in `EvalSuiteRun`, plus
  `workspace_id` FK for tenancy (today `eval_runs` inherits it through the case,
  which forces a join on every dashboard query). `agent_version` int,
  `skill_versions` jsonb and `case_set_revision` text carry `EvalRunInputs`
  flattened. `status` exists so the boot reaper can sweep it the way it sweeps
  `agent_runs`.
- **`eval_runs`** — add `suite_run_id` (FK, `on delete cascade`),
  `findings_kept`, `findings_dropped`, `case_revision` int, `violations` jsonb.
- **`eval_cases`** — add `unlisted` (text enum, not null, default `'ignore'`),
  `source_pr_id` (FK → `pull_requests`, `on delete set null`), `revision` int not
  null default 1, `created_at`. `expected_output` now holds `EvalTarget[]` —
  keep the column, narrow its meaning. **No `expectation_kind` column**; the kind
  is inside each target.

`source_pr_id` and each target's `source_finding_id` are nullable-on-delete
rather than cascade **on purpose**: a case must outlive the finding and the PR it
came from, or the set silently shrinks every time an old PR is cleaned up. That
is a regression suite quietly losing its regressions.

**`revision` bumps only on a measurement-affecting edit** — `input_diff`,
`targets`, or `unlisted`. Renames and notes do not touch it. That is what lets
the trend chart break its line honestly at the point the test changed instead of
drawing through it (gap 6).

`isConfigChange` (`server/src/modules/agents/helpers.ts:70`) is the structural
precedent — one predicate deciding whether an edit is version-worthy — but
**not** the behavioural one: it bumps on `name` and `description` too. Copy its
shape, not its field list. A case renamed to fix a typo must not break the trend.

Cases are **not** versioned into a history table. A suite run records the
`case_revision` it measured and the set-level `case_set_revision`; when those
differ, the UI says the set changed rather than reconstructing what it used to
be. Full case versioning is available later without a rewrite — `revision` is
already the key it would hang off — and buying it now costs a table and a UI for
a question ("what did this case look like in May?") nobody has asked yet.

## Scoring — code only, no model

`server/src/modules/evals/scoring.ts`. Pure functions, no DB, no LLM, hermetic
tests. This file is where the feature's credibility lives; if it is wrong, every
number on every screen is wrong and looks fine.

**Match rule — the only one.** A grounded finding `f` matches a target `t` when
`f.file === t.file` **and** `[f.start_line, f.end_line]` intersects
`[t.start_line, t.end_line]` (inclusive, non-empty intersection).

**`title`, `severity` and `category` are never matched on.** They are stored and
shown so a human can read the case, and the mockup's expected-output JSON
displays them — which is exactly why someone will wire a string comparison to
`title` and produce a scorer that fails on a reworded finding. Severity mismatch
(the key found as `SUGGESTION` instead of `CRITICAL`) is a real failure the v1
scorer deliberately does not catch; see *Open questions*.

**Aggregation is over targets and violations, not over cases.** Targets of both
kinds coexist inside one case, so scoring iterates targets and never branches on
the case.

**Resolve each finding against at most one target, most specific first.** A
finding can overlap both a `must_find` and a `must_not_flag` target; without a
rule it would score TP and FP simultaneously. Order: `must_not_flag` wins. A
range the user explicitly said not to flag is a stronger, more recent statement
than a range they said to find, and scoring it as a hit would let an agent earn
recall for producing exactly the noise that was dismissed.

Both counters are then in the **same unit — findings, not targets** — which is
what makes `TP / (TP + FP)` a ratio rather than a mixture:

- `TP` = grounded findings matching at least one `must_find` target. One finding
  spanning three targets counts **once**.
- `FN` = `must_find` targets no finding matched. Counted over *targets*, which is
  correct: recall asks what share of the expected set was found.
  `recall = matched must_find targets / all must_find targets`.
- `FP` = grounded findings that either match a `must_not_flag` target, **or**
  match no target at all in a case whose `unlisted` is `'forbid'`. One finding
  counts once regardless of how many targets it hits.
  `precision = TP / (TP + FP)`.
- `citation_accuracy = Σ kept / Σ (kept + dropped)` over all cases, taken from
  `ReviewOutcome` at run time.
- A case passes when every one of its `must_find` targets matched **and** it
  produced zero `FP` — which, under `unlisted: 'forbid'`, includes any finding
  matching no target at all. `cases_passed / cases_total` is the `17/20`.

Recall's denominator is targets and precision's is findings **on purpose**, and
the two therefore do not share a denominator. Say so wherever both are shown; a
reader who assumes one confusion matrix produced both will misread every delta.

**Under the default `unlisted: 'ignore'`, an extra finding is not a false
positive.** An agent that finds the planted bug *and* a second real bug in the
same diff has not degraded, and code cannot tell that second finding from noise
without a human. The labelled negative signal is the dismissed finding, sitting
in the same case as a `must_not_flag` target — which is precisely why precision
is driven by dismissals.

`unlisted: 'forbid'` is the opt-in for the two situations where silence *is* the
assertion: the whole-diff negative control (zero targets — the mockup's
`clean-refactor-no-flags`), and a case deliberately tightened once its diff is
known to hold nothing else worth reporting.

**Empty denominators return `null`, never `0`.** A set of only negative controls
has no `must_find` targets; scoring it `recall: 0` would render as a catastrophe
in the exact case where the agent did everything right. Same for `precision` when
`TP + FP === 0` and `citation_accuracy` when the agent returned nothing. The UI
renders `n/a`.

**Single-case runs get `scope: 'case'` and are excluded from trends and
dashboard aggregates.** The ▷ button on a case row is a debugging affordance;
letting those points into the metric trend puts a spike in the chart every time
someone iterates on one case.

## Where the code goes

New `server/src/modules/evals/`, registered in `src/modules/index.ts`. Per
`.claude/skills/onion-architecture/references/server-module-pattern.md`:

- `routes.ts` — Zod `params`/`body`/`response` from `@devdigest/shared`,
  `getContext` for tenancy, delegates. No Drizzle.
- `service.ts` — case creation from a finding, run orchestration, dashboard
  aggregation. Reaches other modules only through the container.
- `executor.ts` — the replay loop.
- `scoring.ts` — pure, as above.
- `repository.ts` — the eval tables only.

**Do not reuse `ReviewRunExecutor`.** It persists `reviews` and `findings` rows,
creates `agent_runs`, and builds repo-intel context — an eval run must do none of
those. It calls `reviewPullRequest` the same way; that is the extent of the
overlap, and the shared part is already a plain function.

The executor's contract, which is gap 5's fix:

- `diff` — `parseUnifiedDiff(case.input_diff)`. Nothing else.
- `systemPrompt`, `model`, `strategy` — resolved from
  `agent_versions.config_json` for the version being run, **not** from the live
  agent row. A run started before an edit and read after it must still describe
  the version it ran.
- **skill bodies — from `skill_versions`, never from `skills.body`.** Resolve
  each linked skill id in `config_json.skills` to the skill's *current*
  `skills.version` at run start, read the body from `skill_versions`, and record
  the `(skill_id, version)` pairs on the run. Reading the live body instead is
  the gap-5 leak: it makes the run's own `agent_version` label untrue, and
  nothing downstream can detect it.
- `repoMap`, `callers`, `intent`, `specs`, `memory` — **not supplied**,
  unconditionally, regardless of `agent.repo_intel`. This is the freeze.
- `prDescription`, `task` — only from `case.input_meta`.
- `temperature` must be **pinned to 0 explicitly, by the eval executor**, and
  recorded on the run. Do not inherit the provider default: only OpenRouter
  defaults to 0 (`reviewer-core/src/llm/openrouter.ts:72`) — `openai.ts:74` and
  `anthropic.ts:72` both default to `?? 0.2`. An agent on those providers would
  otherwise be A/B-tested at a sampling temperature, and the run-to-run spread
  would be read as a prompt effect. There is no seed parameter on any provider,
  so determinism stays best-effort even at 0 — the other reason the experiment
  needs repeats.

`POST /agents/:id/eval-runs` follows the review pattern: create the
`eval_suite_runs` row as `running`, return `202 { run_id }`, execute in the
background, stream over `container.runBus`, and sweep stale `running` rows in the
boot reaper next to `reapStaleRuns()` (`app.ts:89`).

### Routes

| Route | Purpose |
| --- | --- |
| `POST /findings/:id/eval-case` | One click. Derives everything (below). |
| `GET`/`POST /agents/:id/eval-cases` | List / create manually |
| `PUT`/`DELETE /eval-cases/:id` | Edit, remove |
| `POST /eval-cases/:id/run` | One case, `scope: 'case'` |
| `POST /agents/:id/eval-runs` | Run the set → `202 { run_id }` |
| `GET /agents/:id/eval-runs` | History (`EvalSuiteRun[]`) |
| `GET /eval-runs/:id` | Detail + per-case rows |
| `GET /eval-runs/:id/events` | SSE progress |
| `GET /agents/:id/eval-dashboard`, `GET /eval/dashboard` | Aggregates |

**No compare route.** The compare view fetches two `GET /eval-runs/:id` and two
`GET /agents/:id/versions/:version`, and diffs the prompts client-side. Both
routes ship today.

`POST /findings/:id/eval-case` derives, in order:

1. **Target kind** from the decision — `accepted_at` → `must_find`,
   `dismissed_at` → `must_not_flag`. Neither set → **422**, "decide on this
   finding first". An undecided finding carries no label and would be a made-up
   test case, which is the one thing this feature exists to avoid.
2. **The target** from the finding's `file` / `start_line` / `end_line`, carrying
   `source_finding_id`.
3. **The owner** from `reviews.agent_id` via `findings.review_id`.
4. **The case — existing or new.** If a case for this owner already has
   `source_pr_id` equal to the finding's PR, **append the target to it** and bump
   its `revision`. Only otherwise create a case. One PR is one frozen diff; three
   findings on it are three targets, not three near-identical replays (gap 3).
5. **`input_diff`** (new cases only) — the **whole PR diff**, assembled exactly
   as `diffFromPrFiles()` does it, not just the finding's file, and never a
   trimmed hunk. Two reasons, both load-bearing: the grounding gate matches line
   numbers against real hunks, so re-windowing a patch shifts the numbers and
   drops the finding it was built from; and the finding was produced while the
   agent saw the whole diff, so a single-file replay changes the conditions and
   the case may simply not reproduce.
6. **Idempotency** — if any target in any case already carries this
   `source_finding_id`, return that case as-is with `200`. No duplicate target,
   no revision bump.

### Client

- **`NAV`** gains `{ key: "eval", label: "Eval Dashboard", icon: …, href:
  "/eval", gKey: "e" }` in `client/src/vendor/ui/nav.ts:21`. **This needs an
  explicit exception**: root `CLAUDE.md` lists `**/src/vendor/**` as do-not-touch
  with a carve-out only for `vendor/shared`, but `NAV` is the sole nav
  registration point — there is no prop-based extension (`client/INSIGHTS.md`,
  2026-08-14). Precedent exists; do not let an implementer discover the conflict
  alone and guess.
- **`/eval` page** — `client/src/app/eval/page.tsx`. `activeKeyFor` already
  routes to it (`helpers.ts:35`).
- **Evals tab** — one entry appended to `TABS`
  (`client/src/app/agents/[id]/_components/AgentEditor/constants.ts:11`, today
  `config` / `skills` / `context`). `VALID_TABS` is **derived** —
  `TAB_KEYS = TABS.map(tb => tb.key)` (`constants.ts:18`) — so no second list
  needs editing. The render is a three-way nested ternary
  (`AgentEditor.tsx:24-30`) and should become a switch or a lookup map at four
  tabs rather than a fourth nesting level.
- **FindingCard** gains a "Turn into eval case" action next to Accept/Dismiss
  (`FindingCard.tsx:110`), disabled with a tooltip until the finding is decided —
  matching the 422 above rather than letting the user discover it by clicking.
- **Hooks** in `client/src/lib/hooks/evals.ts`, following `usePrReviews`
  (`hooks/reviews.ts:53`): `useQuery` keyed `["eval-cases", agentId]` /
  `["eval-runs", agentId]`, mutations invalidating both.
- **Charts** — `MetricCard` + `Sparkline` for the three metric tiles,
  `LineChart` for the trend. No new dependency.

## Phases

Each ships and reviews independently.

1. **Schema + scoring.** Contracts, migration, `scoring.ts` with hermetic tests
   covering: overlap boundaries (touching, adjacent, contained), empty
   denominators → `null`, a case holding both target kinds at once, `unlisted:
   'forbid'` with and without targets, and extras under `'ignore'` *not*
   counting as FPs. No routes yet. Scoring is testable with zero infrastructure
   and it is what everything else trusts.
2. **Case creation + run.** `POST /findings/:id/eval-case`, the executor, `POST
   /agents/:id/eval-runs`, SSE, the reaper entry. Route tests are
   `*.it.test.ts`; the executor gets a hermetic test with `MockLLMProvider`
   (`adapters/mocks.ts`, used at `reviewer-core/test/run.test.ts:14`).
3. **Evals tab.** Case list, editor modal, run history, run detail, the
   FindingCard button.
4. **Dashboard + compare.** `/eval`, per-agent trend, the two-run compare with
   the prompt diff.
5. **The experiment.** Below.

## Acceptance criteria

1. Accepting a finding, clicking "Turn into eval case", and running the set
   produces a **passing** case — the agent finds, on a frozen replay, the thing
   it just found live. If this fails, the freeze in gap 5 is wrong and nothing
   downstream means anything.
2. Clicking the button twice on the same finding yields **one** case (`200`,
   same id) with **one** target, and no revision bump.
3. A finding with neither `accepted_at` nor `dismissed_at` returns **422**, and
   the client disables the button with a reason rather than surfacing the error.
4. A dismissed finding becomes a `must_not_flag` target at that finding's
   `file:line`; another agent finding elsewhere in the same diff does **not**
   fail it.
5. Accepting one finding and dismissing another **on the same PR**, then clicking
   the button on both, produces **one** case holding one `must_find` and one
   `must_not_flag` target — not two cases, and not two copies of the diff. The
   run replays that diff once.
6. A set containing only `must_not_flag` targets reports `recall: null` rendered
   as `n/a` — never `0%`.
7. A case with zero targets and `unlisted: 'forbid'` passes when the agent
   returns nothing and fails on any grounded finding — the negative control the
   mockup badges `empty []`.
8. Two runs at the same agent version over the same cases produce identical
   `recall`/`precision` when driven by `MockLLMProvider`. Any difference is a
   leak in the frozen inputs.
9. **Editing a linked skill's body between two runs is visible.** The two runs
   carry different `skill_versions`, the compare view says the skills changed,
   and it does **not** present them as two runs of the same thing merely because
   `agent_version` is equal on both. This is the gap-5 regression test; without
   it the version label is decorative.
10. A run resolves skill bodies from `skill_versions`. Grep proves the eval
    executor never reads `skills.body`.
11. **Editing a case's targets bumps `revision`; renaming it does not.** After a
    measurement-affecting edit, the trend line breaks at that point rather than
    drawing through it, and the compare view refuses to present two runs with
    different `case_set_revision` as a like-for-like prompt comparison.
12. Deleting the PR an eval case came from leaves the case runnable, with
    `source_pr_id` and the affected targets' `source_finding_id` null.
13. A run row records the `agent_version` it ran at, and editing the agent's
    prompt afterwards does not change what a finished run reports.
14. `citation_accuracy` comes from `ReviewOutcome`'s kept/dropped counts stored
    as integers. Grep proves nothing parses `agent_runs.grounding` or any `"n/m
    passed"` string.
15. Where `citation_accuracy` is displayed, findings of `FULL_FILE_KINDS` are
    disclosed as grounding-exempt — a tooltip or a footnote. A bare 95% that
    mostly means "the gate had nothing to check" is a misleading number, not a
    missing one.
16. A single-case run does not appear in the metric trend or in the dashboard
    aggregates.
17. Killing the server mid-run leaves a `running` row that the boot reaper moves
    to `failed`, exactly as `agent_runs` behaves today.
18. Compare v6 → v7 renders metric deltas and the system-prompt diff using only
    `GET /eval-runs/:id` and `GET /agents/:id/versions/:version`. No new server
    route was added for it.

## The experiment

The deliverable is evidence, not a screenshot of a green number.

1. **Baseline** — run the set at the current version, `--runs 5`.
2. **Improve** — edit the system prompt (version bumps), run 5.
3. **Break it on purpose** — add a line that provokes noise. The mockup's own v7
   diff has the right shape: `Flag unused imports as suggestions.` — an
   instruction to emit findings nobody asked for. Run 5. **Precision must fall**,
   and the `must_not_flag` cases must be what falls first.

`server/scripts/skills-experiment.ts` is the shape to copy (`pnpm
experiment:skills --runs 5`); add `pnpm experiment:evals`.

Two constraints, both already paid for once (`INSIGHTS.md`, *What Works*,
2026-08-14):

- **Report a distribution, not a pair.** One run per condition is noise. The
  first version of the skills experiment reported "0 findings without skills" and
  the very next identical invocation returned 1. Report `n=5` per condition with
  the spread; a 2-point precision move inside the run-to-run spread is not a
  result and must not be written up as one.
- **Change one thing — and let the code check it.** Same cases, same model, same
  skills; only the prompt. This is no longer a discipline: `EvalRunInputs` records
  agent version, skill versions and case-set revision, so two runs differing in
  more than one component are detectable, and the compare view should say so
  rather than render a confounded delta as a clean result. Criteria 8, 9 and 11
  are the checks that it holds.

The negative-control case is the same pattern that already works elsewhere in
this repo — a clean fixture that must produce nothing, worth writing for *any*
severity-tiered artifact (`INSIGHTS.md`, *What Works*, 2026-08-29). Here
`must_not_flag` **is** that pattern, and the dismissals mean we get it for free
instead of authoring it.

## Open questions

- **Should a severity mismatch fail a `must_find` case?** Finding the Stripe key
  as `SUGGESTION` instead of `CRITICAL` is a real regression — only `CRITICAL`
  trips the merge gate — but locking severity makes cases brittle against
  reasonable re-tuning. `EvalTarget` already carries `severity`, so a
  `match_severity` flag is a later addition, not a migration. Decide on real
  data.
- **Is excluding repo-intel from the freeze too pure?** An agent with
  `repo_intel: true` is evaluated in a configuration it never runs in
  production, so the numbers may not transfer. The alternative — snapshotting the
  repo-intel digest into `input_meta` at case creation — restores fidelity and
  freezes it, at the cost of a much larger case and a snapshot that ages. Ship
  frozen-without; revisit if accepted cases systematically fail to reproduce.
  ("Run on save" in the mockup exists for exactly this: it tells you at creation
  time whether the case reproduces, instead of at the next regression run.)
- **How big can `input_diff` get before the set is unusable?** Whole-PR diffs are
  correct (see route derivation, point 5) and unbounded. A 4,000-line diff over
  20 cases is a slow, expensive run and may trip the map-reduce threshold
  (`mapThresholdLines`, default 400), which changes the execution path between
  cases. Cap somewhere, or accept that big-PR cases run map-reduce and record the
  mode on the run.
- **What should a run cost, and who stops it?** 20 cases × a real model, times
  "Run all agents" on the dashboard, is an unbounded button. A concurrency cap
  and a per-run USD ceiling are both needed; whether the ceiling aborts or just
  warns is a product call.
- **Is `precision` the right name for what we compute?** It is `TP / (TP + FP)`
  over a deliberately conservative FP set — `must_not_flag` violations plus
  unmatched findings only where `unlisted: 'forbid'` — not classical precision
  over all findings. It moves the way the mockup implies, but someone will
  eventually compare it to a textbook number and find it flattering. Either
  rename it or document the denominator where it is displayed.
- **Which agent owns a case made from a detector finding?** The owner comes from
  `reviews.agent_id`, which is a **nullable `uuid` with no foreign key**
  (`db/schema/reviews.ts:17`). Findings from the built-in hook detectors
  (`secret_leak`, `phantom`) can arrive on a review with no agent, and then
  "Turn into eval case" has nothing to attach to. Either hide the button for
  agent-less findings, or let the user pick the owning agent in the dialog.
- **Where does eval spend show up?** The executor deliberately creates no
  `agent_runs` row, so eval cost is invisible to Agent Performance and to every
  existing cost view — while being real money, and plausibly more of it than
  reviews once "Run all agents" exists. Either surface `eval_suite_runs.cost_usd`
  in the same places, or accept two separate cost stories and say so in the UI.
