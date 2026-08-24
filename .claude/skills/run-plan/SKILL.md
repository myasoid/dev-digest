---
name: run-plan
description: "Executes an approved Development Plan through the implement → verify pipeline: implementer, then plan-verifier + architecture-reviewer in parallel, then a bounded fix loop. Requires a finished plan from implementation-planner — it never writes a spec or a plan itself, and never invokes spec-creator or implementation-planner. Use when the user says 'run the plan', 'execute the plan', 'implement this plan', 'run-plan', or hands over an approved Development Plan and asks for it to be built. Skips test-writer and doc-writer by default to save tokens; --tests / --docs re-enable them."
version: 1.0.0
argument-hint: <path-to-plan-or-"see above"> [--tests] [--docs] [--no-arch]
allowed-tools: Agent, Read, Grep, Glob, Bash(git diff:*), Bash(git status:*), Bash(git log:*), Bash(git merge-base:*), Skill, AskUserQuestion
---

# run-plan

Runs the **second half** of this repo's spec-driven pipeline. You are the
orchestrator: you dispatch subagents, carry artifacts between them, and decide
when the loop is done. You do not implement, verify or review anything yourself.

```
implementer  →  wave 1: plan-verifier ∥ architecture-reviewer  →  fix loop  →  report
```

Companion file, read it when a step says to:

| File           | What it holds                                        |
| -------------- | ---------------------------------------------------- |
| `handoffs.md`  | exact required inputs and verbatim text, per agent    |

## The boundary — the first half is not yours

`spec-creator` and `implementation-planner` are run **manually, one session
each, by a human**, and are deliberately outside this skill. Requirements and
planning are where a wrong answer is cheapest to catch and where reading the
artifact yourself beats any amount of downstream verification.

**Never invoke `spec-creator` or `implementation-planner` from here, and never
do their job inline.** If no plan exists, stop and say so. Writing the plan
yourself so the pipeline can proceed defeats the split: `plan-verifier` would
then be checking the code against a plan authored by the same session that
wrote the code, which verifies nothing.

## Arguments

`$ARGUMENTS` is the plan reference plus optional flags.

| Argument | Meaning |
| --- | --- |
| *(plan reference)* | Path to a plan file, or `see above` when it is already in this conversation. **Required.** |
| `--tests` | Also run `test-writer` (wave 2). Off by default. |
| `--docs` | Also run `doc-writer` at the end. Off by default. |
| `--no-arch` | Skip `architecture-reviewer`. |

## Step 0 — Get the plan, and check that it is one

Resolve the plan reference, then confirm it is a Development Plan from
`implementation-planner`: it should carry `Objective`, `Steps` with per-step
file and skill assignments, and `Verification`.

If what you have is a spec, a prose request, or a plan with no Steps, **stop and
name which one it is.** Do not hand it to `implementer` — its own Step 0 will
bounce it straight back, and you will have paid for the round trip. A spec in
particular means the planning stage has not run yet; say that, and stop.

Capture the baseline before anything changes:

```!
git merge-base main HEAD && git status --short
```

If the working tree is already dirty, say so and ask whether to proceed — a
pre-existing change will otherwise land in the diff that `plan-verifier` reads
and be reported as scope creep against a plan that never mentioned it.

## Step 1 — implementer

Dispatch `implementer` with the plan. Read `handoffs.md` § `implementer` for the
required inputs and the verbatim text to include.

Keep its **Implementation Report** intact — both wave-1 agents consume it and
neither can reconstruct it.

## Step 2 — wave 1: verify and review, in parallel

Dispatch `plan-verifier` and `architecture-reviewer` **in a single message so
they run concurrently.** Both are read-only, so they cannot conflict. Skip
`architecture-reviewer` entirely under `--no-arch`.

Read `handoffs.md` for both — `plan-verifier` in particular needs all three of
its inputs plus a specific paragraph about the skipped test stage, without which
it will file every untested acceptance criterion as a gap.

## Step 3 — the fix loop

Read both reports. Decide, and say out loud which rule fired:

| Result | Action |
| --- | --- |
| `plan-verifier` reports **gaps** | Back to `implementer` with *only* the gap list, the plan, and its previous report. A gap is a correction, not a re-run — do not resend the whole plan as new work. |
| `architecture-reviewer` reports **`CRITICAL`** | Same, with the findings. Note in your summary that this agent is advisory: you *chose* to act on it, nothing forced you. |
| `architecture-reviewer` reports **`WARNING`/`SUGGESTION`** only | Do not loop. Surface them and let the user decide. |
| `plan-verifier` reports **"Could not verify"** | **Not a gap.** Decide or escalate to the user — do not send it to `implementer` as work. |
| Both clean | Done. Go to Step 4. |

After a fix pass, re-run **only `plan-verifier`**, and only against the gaps it
raised. Re-running the full wave on a two-line fix is how this skill stops being
worth invoking.

**Cap the loop at two fix passes.** If gaps survive two passes, stop and hand
both reports to the user. A third automated attempt on the same gap means the
*plan* is wrong, not the code — and re-litigating the plan is not yours to do.

## Step 4 — optional stages

- `--tests` → dispatch `test-writer` **now**, never earlier. See `handoffs.md`
  for why the ordering is load-bearing.
- `--docs` → dispatch `doc-writer` last, with the `plan-verifier` report
  included so the spec `Status:` flip is not lost.

## Step 5 — close out

1. **Report** what shipped, what each wave-1 agent said, and how many fix passes
   ran.
2. **Name every skipped stage** — `test-writer` and `doc-writer` by default,
   `architecture-reviewer` under `--no-arch`. A skipped stage that goes
   unmentioned reads as a stage that passed. This repo already holds that line
   for test suites (`TESTING.md`, `conventions.md`); it applies to agents too.
3. **State the test gap plainly** when `--tests` was not passed: new behaviour
   in this change has no new test, and the implementer's run only proves it did
   not break tests that already existed. Do not soften this.
4. **Say that nothing here gates merge.** `pr-self-review` is the only thing
   wired to one (`scripts/pr-gate.sh` as a `PreToolUse` hook), and it has not
   run. Suggest it as the next step.
5. **Run `engineering-insights` once, here.** The subagents do not run it — they
   return `Insight candidates` instead. Collect theirs, apply that skill's own
   bar and 3-entry cap, and note that you are the orchestrating session it
   names.

## Skipped stages — read before dispatching

`test-writer` is off by default to save tokens. That cost is real, and it has to
be carried into the reports rather than disappearing:

- `plan-verifier` must not turn "no test exists" into "requirement not met".
  Step 2 gives it the wording.
- The only test signal is the **existing** suite passing. That proves no
  regression; it proves nothing about the new behaviour.
- Any acceptance criterion whose only observable check was a test is, honestly,
  unverified. Say so in Step 5.

Re-enable with `--tests` whenever the new behaviour *is* the point — a contract
change, a new route, a state machine.

## What this skill does not do

- **Write a spec or a plan.** Upstream, manual, and deliberately so.
- **Gate anything.** Every agent here is advisory. `pr-self-review` is the gate.
- **Review code quality or security.** `pr-self-review` routes those skills,
  including `security` by hunk content.
- **Write `INSIGHTS.md` from a subagent.** Step 5 is the only place that happens.
