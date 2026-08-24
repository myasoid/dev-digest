# Handoff contracts — what each agent must be given

One section per agent this skill dispatches. Each lists the **required** inputs,
the text to pass **verbatim**, and what to keep from the result.

The rule behind all of them: these agents share no context with you and none with
each other. Everything an agent needs must be *in the message you send it*. An
agent that has to ask you for a missing input has already cost a round trip, and
`implementer`, `test-writer` and `plan-verifier` all have a hard Step 0 that
stops them when an input is absent.

---

## `implementer`

**Required:** the Development Plan. Nothing else is optional-but-nice — without
the plan it refuses to start, by design.

**Send:**

- the full plan text, or a path it can `Read`
- the baseline sha from Step 0, so it knows what "your changes" means
- verbatim, when `--tests` was **not** passed:

  > `test-writer` is not running for this change. Do not write new tests beyond
  > what the plan's own steps ask for, and do not treat missing test coverage as
  > a blocker — note it under "Out of scope (explicitly deferred)".

**Keep:** the whole **Implementation Report**, unedited. Both wave-1 agents need
it and neither can reconstruct it from the diff. In particular keep "Changes
made" (it is `architecture-reviewer`'s scope) and "Deviations from plan" (it is
the first thing `plan-verifier` should reconcile against).

**Do not** paraphrase the report into a summary before passing it on. The
summary loses exactly the per-file detail the next two agents index on.

---

## `plan-verifier`

**Required, all three:** the Development Plan, the Implementation Report, and
the diff. It will stop and ask if any is missing — it never infers a plan from a
diff.

**Send:**

- the plan (full text or path)
- the Implementation Report from `implementer`
- `git diff <baseline>` output, or the explicit file list from "Changes made"
- the spec path, if the plan traces to one — its `Acceptance criteria` section
  is what this agent checks against in preference to the plan's own steps
- verbatim, when `--tests` was **not** passed:

  > `test-writer` did not run for this change. Acceptance criteria whose
  > verification hint is a test (`hermetic unit test`, `*.it.test.ts`,
  > `e2e flow`) have no test by design, not by omission. Judge those criteria
  > against the **code**, and list the absent tests once under "Could not
  > verify" — do not report each as a gap. A missing test is not a missing
  > requirement.

**Keep:** the compliance matrix, the Gaps list, and "Follow-ups for doc-writer".

**Read its verdict carefully.** It runs on `sonnet` with a prompt that forbids an
uncited "Met", so "Could not verify" is a real and expected outcome, not a
failure of the agent. Treat that bucket as **your** decision to make or escalate
— do not send it back to `implementer` as though it were a gap.

---

## `architecture-reviewer`

**Required:** a changed-file scope.

**Send:**

- the Implementation Report's "Changes made" list as the scope
- the baseline sha
- which boundary applies, if you already know: `server/` + `reviewer-core/` →
  onion-architecture, `client/` → frontend-ui-architecture, or both. Saying so
  saves it an `AskUserQuestion` round trip.

**Keep:** findings at `CRITICAL` only for the fix loop. `WARNING` and
`SUGGESTION` go in the final summary, unactioned.

**Remember what it is.** Advisory, on `sonnet`, and substantially duplicated by
`pr-self-review`, which routes the same two skills over the same files with
grounding and adversarial verification behind it. If a finding looks like an
invented rule rather than a checklist item, it probably is — that is the failure
mode its model choice is most exposed to, and its own prompt tells it to put
uncovered concerns under "Could not verify" instead.

---

## `test-writer` — only with `--tests`

**Required, both:** the Development Plan **and** the Implementation Report. With
a plan alone it switches to `TDD-first` mode, which is not what you want here.

**Send:** both documents, plus the wave-1 verdicts so it knows the code it is
testing is final.

**Dispatch it only after wave 1 is clean.** It writes files against the code as
it stands; run it against an implementation that still has gaps and its tests
get rewritten after the fix pass. That ordering is the whole reason wave 2
exists.

---

## `doc-writer` — only with `--docs`

**Required:** the plan and the Implementation Report. The `plan-verifier` report
is optional for the agent but you should pass it anyway — its "Follow-ups for
doc-writer" section is what carries the spec `Status: shipped` flip, and
`plan-verifier` has no `Write` to do that itself.

**Send:** plan, Implementation Report, `plan-verifier` report.

**Keep:** the list of files it wrote, for the final summary.

---

## What none of them do

No agent in this set writes `INSIGHTS.md`. `implementer` and `doc-writer` return
an **Insight candidates** section instead; `plan-verifier` and
`architecture-reviewer` have no `Write` at all. Collecting those and running
`engineering-insights` once is the orchestrator's job — see `SKILL.md` Step 5.
