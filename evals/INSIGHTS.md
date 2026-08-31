# Insights — evals

Quirks of the eval harness itself (`src/`, the CLI scripts) — read before
trusting `eval:repeat` / `eval:delta` / `eval:benchmark` output at face value.

Read at the start of a task, written at the end of one, by the
`engineering-insights` skill. Sections are fixed — add to the one that fits,
newest first. If it would be obvious to anyone reading the code, leave it out.

---

## Decisions

## What Works

## What Doesn't Work

- **2026-08-29** — `pnpm eval:delta <A> <B>` does not merge two *different*
  agents' labeled repeats, even when a case's `name` is byte-identical in both
  `*.cases.ts` files. Ran `eval:repeat agents/architecture-reviewer -n 5
  --label strict` and `eval:repeat agents/architecture-reviewer-lite -n 5
  --label lite`, then `eval:delta strict lite`: every row rendered one-sided
  (`—% -> 100%` or `X% -> —%`) instead of a merged `X% -> Y%`, for all 4 cases
  including the 3 whose `name` matches verbatim across
  `agents/architecture-reviewer/architecture-reviewer.cases.ts` and
  `agents/architecture-reviewer-lite/architecture-reviewer-lite.cases.ts`.
  Cause: the nodeid `src/delta.ts` keys on embeds the eval *file's* identity
  (via `describeAgent`), not just the test's display name, so two agents never
  share a key. `eval:delta` only cleanly pairs repeats of the **same** eval
  file (before/after editing one artifact) — for a cross-agent A/B, read both
  `results/repeat-<label>.json` files and pair rows by test/practice text by
  hand instead of trusting the automatic merge.

## Codebase Patterns

## Tool & Library Notes

- **2026-08-29** — `src/repeat.ts` hardcodes `MAX_TIMES = 2` and silently caps
  any higher `-n` down to it ("token economy"), so `pnpm eval:repeat ... -n 5`
  actually runs 2 iterations, not 5 — stddev stays "indicative only" per the
  tool's own n<5 caveat. To get a real (non-indicative) stddev, bump
  `MAX_TIMES` in `evals/src/repeat.ts:75` before running, then revert it —
  there is no CLI flag for this, only the source constant.

## Recurring Errors & Fixes

## Open Questions
