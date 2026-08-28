# Workflow insights — how the agent system runs

Lessons about **the multi-agent system**, not about DevDigest's code. Codebase
lessons go in `INSIGHTS.md` (root) or `<module>/INSIGHTS.md` instead — see
`.claude/skills/engineering-insights/SKILL.md`.

Written by the `workflow-retro` skill, which is invoked manually after a run
that spawned subagents. Raw per-run measurements live beside this file in
`.claude/workflow-runs/*.json` (gitignored); this file holds only what stays
true across runs.

Every entry carries three parts — **Measured** (from `collect.py`), **Judged**
(the half no transcript can show, or "not assessed"), and **Change** (a named
file). An entry that stops at a diagnosis is an observation, not an insight.
Roughly 5 entries per section, newest first.

---

## Fan-out & decomposition

### 2026-08-25 — Parallel read-only agents re-fetch the same shared file

**Measured:** 4 agents (3 `Explore` + 1 `spec-creator`), 1.91M weighted input
tokens. `server/src/vendor/shared/contracts/trace.ts` was read independently by
3 of the 4; `reviewer-core/src/prompt.ts` and
`server/src/modules/reviews/run-executor.ts` by 2 each. ~16.7k redundant
grounding tokens across 7 duplicated files. The 3-agent cluster spanned 115.6s
with a 32.9s straggler gap.
**Judged:** all four reports were used; none was discarded. The overlap was in
files read, not in scope — the decomposition itself (one sweep per package) was
right.
**Change:** when fanning out over packages that share a contract, read the
shared file once in the parent and paste the relevant excerpt into each brief.
Splitting a sweep N ways multiplies the cache, not just the output — the cost
of this run was 51x its raw input figure. `.claude/agents/README.md`,
fan-out section.

## Cost & model tiering

_None yet._

## Briefs & context

### 2026-08-26 — A scoped fix-pass agent still re-reads the full spec/plan by path

**Measured:** in a `/run-plan --tests` run (7 agents, 34.9M weighted input,
~105 min wall), the fix-pass `implementer` (dispatched with only 3 named gaps
and no instruction to touch anything else) and the later `test-writer`
(dispatched with 6 named focus areas) both re-read the entire
`specs/2026-08-25-project-context.md` (12.4k est. tokens) and
`specs/2026-08-25-project-context-plan.md` (14.4k est. tokens) via their own
`Read` calls, even though each dispatch prompt already quoted the exact AC
text / Step text the agent needed. Combined, these two files account for
66.1k of this run's 125.5k `est_redundant_tokens` — over half.
**Judged:** not a decomposition error — the agents used what they read, and
nothing was discarded. But the re-reads were unprompted: a narrowly-scoped
dispatch (a gap fix, an incremental test pass) does not need the *source of
truth* re-opened when the prompt already embeds the relevant excerpt, unlike
`plan-verifier`/`architecture-reviewer`, whose job specifically requires
independently confirming against the full document rather than trusting a
paraphrase.
**Change:** for a scoped fix-pass or incremental-coverage dispatch (not a
first-pass `implementer`/`plan-verifier`/`architecture-reviewer` run), add one
line telling the agent the embedded excerpt is sufficient and a full
spec/plan re-read is not required unless something referenced isn't already
quoted. `.claude/skills/run-plan/handoffs.md`, `implementer` and `test-writer`
sections.

### 2026-08-25 — Brief a sweep agent to grep contracts and i18n first

**Measured:** three `Explore` briefs of 365/397/417 est. tokens returned
5.9k/8.1k/7.6k tokens (16-20x). None surfaced that
`client/messages/en/context.json` already held the entire feature's UI copy, or
that `contracts/platform.ts:262` already declared its data types. The
orchestrator found both afterwards with two greps. One agent re-read
`run-executor.ts` 4 times and another re-read `knowledge.ts` 3 times — the
re-read signature of a brief that names a topic instead of a path.
**Judged:** the miss was material, not cosmetic: those two files re-sized the
feature from "build a prompt block" to "one unpassed argument plus three UI
surfaces". The briefs were not too short — they were pointed at the wrong tree
first.
**Change:** a sweep brief should open with "grep the feature name across
`*/vendor/shared/contracts/*.ts` and `client/messages/en/*.json` before reading
any implementation". Cheap, and it front-loads the scaffolding inventory that
root `INSIGHTS.md` has now recorded four times. `.claude/agents/README.md`,
Explore brief guidance.

## Friction & tooling

### 2026-08-26 — A pre-existing dirty tree must be excluded in every downstream prompt, not just the first

**Measured:** at Step 0 of a `/run-plan` run, `git status` showed 8 unrelated
uncommitted files (`workflow-retro` skill files, `spec-creator.md`, root
`INSIGHTS.md`, several `specs/README.md` edits) already present before the
plan's own work started. The orchestrator asked the user via
`AskUserQuestion` ("proceed as-is" was chosen), then manually re-stated the
same exclusion list, by name, inside the `implementer`, `plan-verifier`, and
`architecture-reviewer` dispatch prompts individually. All three reports came
back correctly scoped — none flagged the pre-existing files as this plan's
changes or as scope creep.
**Judged:** it worked, but only because the orchestrator remembered to repeat
the list three separate times by hand; `.claude/skills/run-plan/SKILL.md`
Step 0 says to ask the user when the tree is dirty, but does not say the
resulting exclusion list must be propagated into every downstream agent's
prompt. Each of `implementer`/`plan-verifier`/`architecture-reviewer` reads
`git diff <baseline>` itself and has no other way to know which paths predate
the plan — a orchestrator who forgets to restate the list even once would get
a false-positive scope-creep or gap finding on an unrelated file.
**Change:** `.claude/skills/run-plan/SKILL.md` Step 0 — after asking the user
about a dirty tree, explicitly instruct that the resulting exclusion list (or
"proceed as-is, exclude nothing") must be copied into the required inputs for
every subsequent dispatch in `handoffs.md`, not left to the orchestrator to
remember.

### 2026-08-25 — A `SKILL.md` body is argument-substituted; bare `$1` is lost

**Measured:** `workflow-retro`'s own SKILL.md rendered `$1.31` as "the.31" and
`$0.40` as "Run.40" when loaded — `$1` and `$0` had been replaced by words from
the invocation arguments. The file on disk was correct; the substitution
happens at load time, so it is invisible to any check that greps the file.
Caught only by invoking the skill and reading the body back.
**Judged:** silent and general — any `$` followed by a digit in a skill body
is affected, and a corrupted example in a skill is worse than a missing one
because it reads as intentional.
**Change:** never write `$<digit>` in a skill body; use `1.31 USD` or escape
it. Worth a line in the skill-authoring conventions, and the reason to load a
new skill once before trusting it — a file-level review cannot catch this
class of bug. `.claude/skills/README.md`.
